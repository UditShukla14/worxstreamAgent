/**
 * Deterministic Shopify analytics → chat UI XML (ChatGPT / Sidekick pattern).
 *
 * Tool returns structured columns+rows; we render widgets in code.
 * The model only adds commentary — it does not invent chart/stats XML.
 */

const MONEY_TYPES = new Set(['MONEY', 'DECIMAL', 'FLOAT', 'CURRENCY']);
const TIME_TYPES = new Set([
  'DAY_TIMESTAMP', 'WEEK_TIMESTAMP', 'MONTH_TIMESTAMP', 'QUARTER_TIMESTAMP',
  'YEAR_TIMESTAMP', 'HOUR_TIMESTAMP', 'MINUTE_TIMESTAMP', 'SECOND_TIMESTAMP',
  'TIMESTAMP', 'DAY_OF_WEEK', 'HOUR_OF_DAY', 'MONTH_OF_YEAR', 'WEEK_OF_YEAR',
]);
const METRIC_TYPES = new Set([
  'MONEY', 'DECIMAL', 'FLOAT', 'INTEGER', 'PERCENT', 'CUMULATIVE',
  'UNITLESS_SCALAR', 'MULTIPLIER', 'RATING',
]);

const ANALYTICS_TOOLS = new Set([
  'run_shopify_analytics',
  'run_shopify_analytics_query',
]);

export function isShopifyAnalyticsTool(name) {
  return ANALYTICS_TOOLS.has(String(name || ''));
}

function snakeToCamel(name) {
  return String(name || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function humanize(name) {
  const words = String(name || '').replace(/_+/g, ' ').trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function getCell(row, columnName) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, columnName)) return row[columnName];
  const camel = snakeToCamel(columnName);
  if (camel && Object.prototype.hasOwnProperty.call(row, camel)) return row[camel];
  return undefined;
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n) {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatValue(value, dataType) {
  const n = parseNumber(value);
  if (n == null) return value == null ? '—' : String(value);
  const dt = String(dataType || '').toUpperCase();
  if (dt === 'PERCENT') {
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  }
  if (dt === 'INTEGER') return String(Math.round(n));
  if (MONEY_TYPES.has(dt) || /sales|revenue|tax|discount|return|payment/i.test(String(dataType))) {
    return formatMoney(n);
  }
  if (METRIC_TYPES.has(dt)) {
    return Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return formatMoney(n);
}

function formatPeriod(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw || '—';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unwrapAnalyticsPayload(result) {
  if (!result || result.success === false) return null;
  // callWorxstreamAPI shapes: { success, data: { columns, rows } }
  // or { success, data: { data: { columns, rows } } } or nested Laravel
  let node = result.data ?? result;
  if (node?.data && (node.data.columns || node.data.rows)) node = node.data;
  if (node?.data && (node.data.columns || node.data.rows)) node = node.data;
  const columns = Array.isArray(node?.columns) ? node.columns : null;
  const rows = Array.isArray(node?.rows) ? node.rows : null;
  if (!columns || !rows) return null;
  return { columns, rows, parseErrors: node.parseErrors };
}

function classifyColumn(col) {
  const name = String(col?.name || '');
  const dataType = String(col?.dataType || col?.data_type || '').toUpperCase();
  if (/__totals$/i.test(name)) return 'total';
  if (TIME_TYPES.has(dataType)) return 'time';
  if (METRIC_TYPES.has(dataType)) return 'metric';
  return 'dimension';
}

function parseVisualizeType(query) {
  const m = String(query || '').match(/\bVISUALIZE\b[\s\S]*?\bTYPE\s+(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

function pickStatColor(name, index) {
  const n = String(name || '').toLowerCase();
  if (/return|discount|refund/.test(n)) return 'red';
  if (/net|paid|collected|profit/.test(n)) return 'green';
  if (/tax|order/.test(n)) return 'cyan';
  if (/gross|total_sales|total sales/.test(n)) return 'purple';
  const colors = ['blue', 'green', 'purple', 'yellow', 'cyan'];
  return colors[index % colors.length];
}

/**
 * Build chat presentation XML from a Shopify analytics tool result.
 * @param {object} result - MCP / API tool result
 * @param {object} [meta]
 * @param {string} [meta.query] - ShopifyQL (for VISUALIZE TYPE)
 * @param {string} [meta.title]
 * @returns {string} XML fragment or ''
 */
export function buildShopifyAnalyticsPresentation(result, meta = {}) {
  const payload = unwrapAnalyticsPayload(result);
  if (!payload) return '';

  const { columns, rows } = payload;
  if (rows.length === 0) return '';

  const normalized = columns.map((c) => ({
    name: c.name || c.Name,
    dataType: c.dataType || c.data_type || 'STRING',
    displayName: c.displayName || c.display_name || humanize(c.name || ''),
    kind: classifyColumn(c),
  }));

  const timeCol = normalized.find((c) => c.kind === 'time') || null;
  const metricCols = normalized.filter((c) => c.kind === 'metric');
  const visualizeType = parseVisualizeType(meta.query);
  const title = meta.title || 'Shopify report';

  const parts = [];

  // Single-row (or totals-style) → KPI cards
  if (!timeCol || rows.length === 1 || visualizeType === 'single_metric') {
    const row = rows[rows.length - 1];
    const stats = metricCols.slice(0, 8).map((col, i) => {
      const raw = getCell(row, col.name);
      const value = formatValue(raw, col.dataType);
      const label = col.displayName || humanize(col.name);
      const icon = /order/i.test(col.name) ? 'chart' : 'dollar';
      return `<stat label="${escapeAttr(label)}" value="${escapeAttr(value)}" icon="${icon}" color="${pickStatColor(col.name, i)}"/>`;
    });
    if (stats.length > 0) {
      parts.push(`<stats>\n${stats.join('\n')}\n</stats>`);
    }
  }

  // Time series → line chart (Sidekick / Shopify Reports pattern)
  if (timeCol && rows.length > 1 && metricCols.length > 0) {
    const primaryMetric = metricCols[0];
    const points = rows
      .map((row) => {
        const period = formatPeriod(getCell(row, timeCol.name));
        const n = parseNumber(getCell(row, primaryMetric.name));
        if (n == null) return null;
        return `<point period="${escapeAttr(period)}" value="${n}"/>`;
      })
      .filter(Boolean);
    if (points.length > 0) {
      parts.push(
        `<chart type="line" title="${escapeAttr(title)}" color="blue">\n`
        + `<chart-data label="${escapeAttr(primaryMetric.displayName || humanize(primaryMetric.name))}">\n`
        + `${points.join('\n')}\n`
        + `</chart-data>\n</chart>`,
      );
    }
  }

  // Multi-row non-time breakdown → bar chart + compact table
  if (!timeCol && rows.length > 1 && metricCols.length > 0) {
    const dimCol = normalized.find((c) => c.kind === 'dimension') || normalized[0];
    const primaryMetric = metricCols[0];
    const bars = rows.slice(0, 25).map((row) => {
      const category = String(getCell(row, dimCol.name) ?? 'Item');
      const n = parseNumber(getCell(row, primaryMetric.name)) ?? 0;
      return `<bar category="${escapeAttr(category)}" value="${n}"/>`;
    });
    if (bars.length > 0) {
      parts.push(
        `<chart type="bar" title="${escapeAttr(title)}" color="green">\n`
        + `<chart-data label="${escapeAttr(primaryMetric.displayName || humanize(primaryMetric.name))}">\n`
        + `${bars.join('\n')}\n`
        + `</chart-data>\n</chart>`,
      );
    }
  }

  // Always include a data table when multiple rows (auditable like Sidekick export)
  if (rows.length > 1) {
    const cols = normalized.slice(0, 8);
    const headers = cols.map((c) => `<th>${escapeAttr(c.displayName || humanize(c.name))}</th>`).join('');
    const body = rows.slice(0, 30).map((row) => {
      const cells = cols.map((c) => {
        const raw = getCell(row, c.name);
        const display = c.kind === 'time'
          ? formatPeriod(raw)
          : c.kind === 'metric'
            ? formatValue(raw, c.dataType)
            : String(raw ?? '—');
        return `<td>${escapeAttr(display)}</td>`;
      }).join('');
      return `<row>${cells}</row>`;
    }).join('\n');
    parts.push(
      `<table title="${escapeAttr(title)}">\n`
      + `<headers>${headers}</headers>\n`
      + `${body}\n`
      + `</table>`,
    );
  }

  return parts.join('\n\n').trim();
}

/**
 * Collect presentation XML from successful Shopify analytics tool calls.
 * @param {Array<{ name: string, success?: boolean }>} toolsUsed
 * @param {object[]} toolResultPayloads
 * @returns {string}
 */
export function collectShopifyAnalyticsPresentations(toolsUsed = [], toolResultPayloads = []) {
  const blocks = [];
  for (let i = 0; i < toolsUsed.length; i++) {
    const tool = toolsUsed[i];
    if (!isShopifyAnalyticsTool(tool?.name)) continue;
    if (tool?.success === false) continue;
    const payload = toolResultPayloads[i];
    const query = tool?.input?.query || '';
    const xml = buildShopifyAnalyticsPresentation(payload, {
      query,
      title: query ? 'Shopify analytics' : 'Shopify report',
    });
    if (xml) blocks.push(xml);
  }
  return blocks.join('\n\n').trim();
}

/**
 * Strip model-authored stats/chart blocks so deterministic widgets win
 * (avoids "Invalid chart data" duplicates).
 */
export function stripModelStatsAndCharts(text) {
  return String(text || '')
    .replace(/<stats\b[^>]*>[\s\S]*?<\/stats>/gi, '')
    .replace(/<chart\b[^>]*>[\s\S]*?<\/chart>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Merge Sidekick-style widgets + model commentary.
 */
export function mergeShopifyPresentationWithCommentary(presentationXml, modelText) {
  const widgets = String(presentationXml || '').trim();
  if (!widgets) return String(modelText || '');
  const commentary = stripModelStatsAndCharts(modelText);
  if (!commentary) return widgets;
  return `${widgets}\n\n${commentary}`;
}
