/**
 * Compact generate_*_report API payloads for the LLM context.
 * Full report JSON can be huge; the model only needs KPIs + a page of rows
 * + breakdowns to emit stats/chart/table XML.
 */

const MAX_ROWS = 25;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const o = /** @type {Record<string, unknown>} */ (value);
    for (const k of ['label', 'name', 'title', 'value', 'customNumber', 'number']) {
      if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim();
    }
  }
  return '';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function compactEstimateRow(row) {
  const customer = row.customer || row.Customer || row.customer_details;
  const status = row.status || row.Status || row.status_details || row.statusDetails;
  return {
    id: row.id ?? row.estimate_id ?? row.estimateId ?? null,
    number: asText(row.customNumber || row.custom_number || row.estimate_number || row.number || row.name),
    customer: asText(
      (customer && typeof customer === 'object'
        ? (/** @type {Record<string, unknown>} */ (customer)).name
          || (/** @type {Record<string, unknown>} */ (customer)).company_name
          || (/** @type {Record<string, unknown>} */ (customer)).display_name
        : null)
      || row.customer_name
      || row.customerName
      || customer,
    ),
    issue_date: asText(row.issue_date || row.issueDate || row.created_at || row.createdAt),
    status: asText(status),
    grand_total: asNumber(row.grand_total ?? row.grandTotal ?? row.total ?? row.amount),
    gross_profit: asNumber(row.gross_profit ?? row.grossProfit ?? row.gross_profit_total),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function compactInvoiceRow(row) {
  const customer = row.customer || row.Customer || row.customer_details;
  const status = row.status || row.Status || row.status_details || row.statusDetails;
  return {
    id: row.id ?? row.invoice_id ?? row.invoiceId ?? null,
    number: asText(row.customNumber || row.custom_number || row.invoice_number || row.number || row.name),
    customer: asText(
      (customer && typeof customer === 'object'
        ? (/** @type {Record<string, unknown>} */ (customer)).name
          || (/** @type {Record<string, unknown>} */ (customer)).company_name
          || (/** @type {Record<string, unknown>} */ (customer)).display_name
        : null)
      || row.customer_name
      || row.customerName
      || customer,
    ),
    issue_date: asText(row.issue_date || row.issueDate || row.created_at || row.createdAt),
    status: asText(status),
    grand_total: asNumber(row.grand_total ?? row.grandTotal ?? row.total ?? row.amount),
    balance: asNumber(row.balance ?? row.balance_due ?? row.balanceDue),
  };
}

/**
 * @param {any} payload
 * @returns {any[]}
 */
function extractRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.data,
    payload.estimates,
    payload.invoices,
    payload.items,
    payload.rows,
    payload.results,
    payload.list,
    payload?.data?.data,
    payload?.data?.estimates,
    payload?.data?.invoices,
    payload?.data?.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/**
 * @param {any} payload
 * @returns {Record<string, unknown>}
 */
function extractTotals(payload) {
  const src = payload?.totals || payload?.summary || payload?.aggregates || payload?.data?.totals
    || payload?.data?.summary || payload || {};
  if (!src || typeof src !== 'object') return {};
  const keys = [
    ['grand_total', ['grand_total', 'grandTotal', 'total', 'total_amount', 'aggregated_grand_total']],
    ['gross_profit', ['gross_profit', 'grossProfit', 'gross_profit_total', 'grossProfitTotal']],
    ['tax', ['tax', 'tax_total', 'total_tax', 'taxTotal']],
    ['discount', ['discount', 'discount_total', 'total_discount', 'discountTotal']],
    ['applied_cost', ['aggregated_applied_cost_total', 'applied_cost_total', 'cost_total', 'cogs', 'appliedCostTotal']],
    ['count', ['count', 'total_count', 'total', 'records', 'estimate_count', 'invoice_count']],
  ];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [outKey, aliases] of keys) {
    for (const a of aliases) {
      const n = asNumber(src[a]);
      if (n != null) {
        out[outKey] = n;
        break;
      }
    }
  }
  return out;
}

/**
 * @param {any[]} rows
 * @param {(row: Record<string, unknown>) => string} statusFn
 * @returns {Array<{ label: string, count: number, total: number }>}
 */
function statusBreakdown(rows, statusFn) {
  /** @type {Map<string, { label: string, count: number, total: number }>} */
  const map = new Map();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const label = statusFn(row) || 'Unknown';
    const prev = map.get(label) || { label, count: 0, total: 0 };
    prev.count += 1;
    prev.total += asNumber(row.grand_total ?? row.grandTotal ?? row.total) || 0;
    map.set(label, prev);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * @param {string} toolName
 * @param {any} result
 * @returns {any}
 */
export function compactReportToolResult(toolName, result) {
  const name = String(toolName || '');
  if (!/^generate_(estimate|invoice)_report$/.test(name)) return result;

  const root = result?.data != null && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data
    : result;
  const rowsRaw = extractRows(root);
  const isEstimate = name.includes('estimate');
  const compactRow = isEstimate ? compactEstimateRow : compactInvoiceRow;
  const pageRows = rowsRaw.slice(0, MAX_ROWS).map((r) => compactRow(/** @type {Record<string, unknown>} */ (r || {})));
  const totals = extractTotals(root);
  if (totals.count == null && rowsRaw.length) totals.count = rowsRaw.length;

  const breakdown = statusBreakdown(rowsRaw.slice(0, 200), (row) => asText(
    row.status || row.Status || row.status_details || row.statusDetails,
  ));

  const pagination = {
    returned: pageRows.length,
    total: asNumber(
      root?.pagination?.total
      ?? root?.total
      ?? root?.meta?.total
      ?? root?.data?.pagination?.total
      ?? totals.count,
    ),
    page: asNumber(root?.pagination?.page ?? root?.page ?? root?.meta?.page) || 1,
    has_more: pageRows.length < (asNumber(root?.pagination?.total ?? totals.count) || pageRows.length),
  };

  return {
    success: result?.success !== false,
    report_type: isEstimate ? 'estimate' : 'invoice',
    presentation_hint:
      'You decide the answer shape (prose / stats / table / chart). '
      + 'totals, status_breakdown, and estimates|invoices rows are available if useful.',
    totals,
    status_breakdown: breakdown,
    pagination,
    [isEstimate ? 'estimates' : 'invoices']: pageRows,
  };
}
