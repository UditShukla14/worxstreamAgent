/**
 * Reconcile OUR usage ledger against Anthropic's own Usage & Cost Admin API.
 *
 * Why: every other number in this system comes from response.usage + our price catalog.
 * Only Anthropic's invoice-grade report can catch wrong catalog prices, unrecorded calls
 * (aborted streams, other services sharing the key) and surprise charges (web search, etc.).
 *
 * Requires ANTHROPIC_ADMIN_API_KEY (sk-ant-admin...). Optional ANTHROPIC_RECONCILE_WORKSPACE_ID
 * restricts the comparison to the workspace this agent's API key lives in — otherwise the report
 * covers the whole organization and any other app on the org will show up as a "difference".
 *
 * Endpoints (legacy Usage & Cost API, curl-only — no SDK wrappers):
 *   GET /v1/organizations/cost_report            amount = USD cents as decimal string, daily buckets
 *   GET /v1/organizations/usage_report/messages  token counts, bucket_width=1d, max 31 buckets/page
 */

import LlmUsageDaily from './models/LlmUsageDaily.js';
import { parseDateRange } from './queries.js';
import { computeEventCost } from './costing.js';

const BASE = process.env.ANTHROPIC_ADMIN_API_BASE || 'https://api.anthropic.com/v1/organizations';
const ANTHROPIC_VERSION = '2026-10-21';
const MAX_DAYS = 62;

export function getAdminKey() {
  return String(process.env.ANTHROPIC_ADMIN_API_KEY || '').trim();
}

export function getReconcileWorkspaceId() {
  return String(process.env.ANTHROPIC_RECONCILE_WORKSPACE_ID || '').trim();
}

/** Anthropic API key ids look like apikey_01AbC...; anything else is rejected before it reaches a URL. */
const API_KEY_ID = /^apikey_[A-Za-z0-9]{8,64}$/;
export const MAX_API_KEY_IDS = 20;

/**
 * Pure: the API key ids typed or pasted into the reconcile window (a list, or one string separated by commas, spaces or
 * lines) -> a de-duplicated list of valid ids. Throws with the offending text when something is not an API key id.
 */
export function parseApiKeyIds(input) {
  const raw = Array.isArray(input) ? input.flatMap((v) => String(v).split(/[\s,;]+/)) : String(input ?? '').split(/[\s,;]+/);
  const ids = [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
  const bad = ids.find((id) => !API_KEY_ID.test(id));
  if (bad) throw new Error(`"${bad.slice(0, 40)}" is not an API key id (they look like apikey_01AbC...; copy it from the Console key's cost link)`);
  if (ids.length > MAX_API_KEY_IDS) throw new Error(`At most ${MAX_API_KEY_IDS} API keys at a time`);
  return ids;
}

const dayStart = (d) => `${d}T00:00:00Z`;
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const dayKey = (iso) => String(iso || '').slice(0, 10);

/** Pure: cost_report page(s) → { 'YYYY-MM-DD': usd } (cents string → USD). Optionally filtered by workspace. */
export function parseCostReport(pages, { workspaceId = '' } = {}) {
  const byDay = {};
  const byType = {};
  for (const page of pages) {
    for (const bucket of page?.data || []) {
      const day = dayKey(bucket.starting_at);
      for (const r of bucket.results || []) {
        if (workspaceId && r.workspace_id !== workspaceId) continue;
        const usd = (Number(r.amount) || 0) / 100;
        byDay[day] = (byDay[day] || 0) + usd;
        const t = r.cost_type || 'unclassified';
        byType[t] = (byType[t] || 0) + usd;
      }
    }
  }
  return { byDay, byType };
}

/** Pure: usage_report page(s) → per-day token totals. */
export function parseUsageReport(pages) {
  const byDay = {};
  for (const page of pages) {
    for (const bucket of page?.data || []) {
      const day = dayKey(bucket.starting_at);
      const acc = byDay[day] || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };
      for (const r of bucket.results || []) {
        acc.input_tokens += r.uncached_input_tokens || 0;
        acc.output_tokens += r.output_tokens || 0;
        acc.cache_read_input_tokens += r.cache_read_input_tokens || 0;
        acc.cache_creation_input_tokens +=
          (r.cache_creation?.ephemeral_5m_input_tokens || 0) + (r.cache_creation?.ephemeral_1h_input_tokens || 0);
        acc.web_search_requests += r.server_tool_use?.web_search_requests || 0;
      }
      byDay[day] = acc;
    }
  }
  return byDay;
}

/**
 * Pure: a usage_report grouped by model (and filtered to some API keys) -> per-day tokens AND the cost of those tokens at our
 * price catalog. Anthropic's cost report cannot be filtered by API key, so for a key selection the dollars are the key's
 * tokens priced here; this checks that every token of those keys was metered (the usual cause of a difference).
 */
export function parseUsageReportPriced(pages) {
  const tokens = parseUsageReport(pages);
  const costByDay = {};
  for (const page of pages) {
    for (const bucket of page?.data || []) {
      const day = dayKey(bucket.starting_at);
      for (const r of bucket.results || []) {
        const usage = {
          input_tokens: r.uncached_input_tokens || 0,
          output_tokens: r.output_tokens || 0,
          cache_read_input_tokens: r.cache_read_input_tokens || 0,
          cache_creation_input_tokens: (r.cache_creation?.ephemeral_5m_input_tokens || 0) + (r.cache_creation?.ephemeral_1h_input_tokens || 0),
        };
        const priced = computeEventCost({ model: String(r.model || ''), usage, markupRate: 0 });
        costByDay[day] = (costByDay[day] || 0) + priced.providerCostUsd;
      }
    }
  }
  return { tokens, costByDay };
}

/** The organisation's API keys (id, name, status, workspace) so the window can offer them by name. Empty when Anthropic refuses. */
export async function listAnthropicApiKeys() {
  const key = getAdminKey();
  if (!key) return [];
  try {
    const pages = await fetchAllPages('api_keys', [['limit', '100']], key);
    return pages
      .flatMap((p) => p?.data || [])
      .map((k) => ({ id: k.id, name: k.name || '', status: k.status || '', workspace_id: k.workspace_id || null, hint: k.partial_key_hint || '' }))
      .filter((k) => API_KEY_ID.test(String(k.id)));
  } catch {
    return [];
  }
}

/**
 * Pure: merge per-day ledger vs Anthropic into comparison rows.
 * @param {Record<string, {cost_usd:number, input_tokens:number, output_tokens:number, cache_read_input_tokens:number, cache_creation_input_tokens:number}>} ours
 * @param {Record<string, number>} theirCost
 * @param {Record<string, object>} theirUsage
 * @param {{ tolerancePct?: number, minDiffUsd?: number, today?: string }} [opts]
 */
export function compareDaily(ours, theirCost, theirUsage, { tolerancePct = 2, minDiffUsd = 0.05, today = new Date().toISOString().slice(0, 10) } = {}) {
  const days = [...new Set([...Object.keys(ours), ...Object.keys(theirCost), ...Object.keys(theirUsage)])].sort();
  const rows = days.map((day) => {
    const o = ours[day] || { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const t = theirUsage[day] || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const a = theirCost[day] || 0;
    const diff = o.cost_usd - a;
    const pct = a > 0 ? (diff / a) * 100 : (o.cost_usd > 0 ? 100 : 0);
    const status = Math.abs(diff) < minDiffUsd || Math.abs(pct) <= tolerancePct ? 'ok' : (diff < 0 ? 'under_recorded' : 'over_recorded');
    return {
      date: day,
      ours_usd: Number(o.cost_usd.toFixed(4)),
      billable_usd: Number((o.billable_usd || 0).toFixed(4)),
      anthropic_usd: Number(a.toFixed(4)),
      diff_usd: Number(diff.toFixed(4)),
      diff_pct: Number(pct.toFixed(2)),
      ours_tokens: o.input_tokens + o.output_tokens + o.cache_read_input_tokens + o.cache_creation_input_tokens,
      anthropic_tokens: t.input_tokens + t.output_tokens + t.cache_read_input_tokens + t.cache_creation_input_tokens,
      output_tokens_diff: o.output_tokens - t.output_tokens,
      is_today: day === today, // today's report may lag a few minutes
      status: day === today && status !== 'ok' ? 'pending' : status,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const totals = {
    ours_usd: Number(sum('ours_usd').toFixed(4)),
    anthropic_usd: Number(sum('anthropic_usd').toFixed(4)),
    diff_usd: Number(sum('diff_usd').toFixed(4)),
    // What to charge customers for the range: the ledger's billable amounts (cost plus markup), not the provider cost.
    billable_usd: Number(sum('billable_usd').toFixed(4)),
  };
  totals.diff_pct = totals.anthropic_usd > 0 ? Number(((totals.diff_usd / totals.anthropic_usd) * 100).toFixed(2)) : 0;
  return { rows, totals, flagged_days: rows.filter((r) => r.status === 'under_recorded' || r.status === 'over_recorded').length };
}

async function fetchAllPages(path, params, key) {
  const pages = [];
  let page = '';
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams();
    for (const [k, v] of params) qs.append(k, v);
    if (page) qs.set('page', page);
    const res = await fetch(`${BASE}/${path}?${qs}`, {
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'user-agent': 'WorxstreamAgentAdmin/1.0',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    pages.push(json);
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }
  return pages;
}

/** Our side: per-day provider cost + tokens from the daily rollup (company totals incl. _unattributed). */
export async function ledgerByDay(from, to) {
  const rows = await LlmUsageDaily.find({
    date: { $gte: from, $lte: to },
    user_id: '',
    agent_key: '',
    model: '',
  }).lean();
  const out = {};
  for (const r of rows) {
    const a = out[r.date] || { cost_usd: 0, billable_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    a.cost_usd += (r.provider_cost_micros != null ? r.provider_cost_micros / 1e6 : r.cost_usd) || 0;
    if (r.company_id !== '_unattributed') a.billable_usd += (r.billable_micros != null ? r.billable_micros / 1e6 : (r.billable_usd ?? r.cost_usd)) || 0;
    a.input_tokens += r.input_tokens || 0;
    a.output_tokens += r.output_tokens || 0;
    a.cache_read_input_tokens += r.cache_read_input_tokens || 0;
    a.cache_creation_input_tokens += r.cache_creation_input_tokens || 0;
    out[r.date] = a;
  }
  return out;
}

/**
 * @param {{ from?: string, to?: string }} range  YYYY-MM-DD (UTC, inclusive)
 */
export async function reconcileWithAnthropic({ from, to, apiKeyIds = [] } = {}) {
  const keyIds = parseApiKeyIds(apiKeyIds);
  const key = getAdminKey();
  const range = parseDateRange(from, to);
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  if (days > MAX_DAYS) throw new Error(`Range too large (max ${MAX_DAYS} days)`);

  const ours = await ledgerByDay(range.from, range.to);
  if (!key) {
    return {
      configured: false,
      message: 'Set ANTHROPIC_ADMIN_API_KEY (an sk-ant-admin… key from the Claude Console) to enable reconciliation.',
      from: range.from,
      to: range.to,
      ours_total_usd: Number(Object.values(ours).reduce((s, o) => s + o.cost_usd, 0).toFixed(4)),
    };
  }

  const workspaceId = getReconcileWorkspaceId();
  const start = dayStart(range.from);
  const end = dayStart(nextDay(range.to));

  const usageParams = [['starting_at', start], ['ending_at', end], ['bucket_width', '1d'], ['limit', '31']];
  if (workspaceId) usageParams.push(['workspace_ids[]', workspaceId]);

  let theirCost;
  let byType;
  let theirUsage;
  if (keyIds.length) {
    // Selected API keys: their tokens (filtered by key, grouped by model) priced at our catalog, because the cost report has no key filter.
    for (const id of keyIds) usageParams.push(['api_key_ids[]', id]);
    usageParams.push(['group_by[]', 'model']);
    const usagePages = await fetchAllPages('usage_report/messages', usageParams, key);
    const priced = parseUsageReportPriced(usagePages);
    theirUsage = priced.tokens;
    theirCost = priced.costByDay;
    byType = { 'tokens of the selected keys, priced at our catalog': Object.values(priced.costByDay).reduce((a, b) => a + b, 0) };
  } else {
    const costParams = [['starting_at', start], ['ending_at', end], ['limit', '31'], ['group_by[]', 'workspace_id'], ['group_by[]', 'description']];
    const [costPages, usagePages] = await Promise.all([
      fetchAllPages('cost_report', costParams, key),
      fetchAllPages('usage_report/messages', usageParams, key),
    ]);
    ({ byDay: theirCost, byType } = parseCostReport(costPages, { workspaceId }));
    theirUsage = parseUsageReport(usagePages);
  }
  const cmp = compareDaily(ours, theirCost, theirUsage);

  return {
    configured: true,
    from: range.from,
    to: range.to,
    scope: keyIds.length
      ? `API key${keyIds.length > 1 ? 's' : ''} ${keyIds.join(', ')}${workspaceId ? ` in workspace ${workspaceId}` : ''} (tokens priced at our catalog)`
      : workspaceId ? `workspace ${workspaceId}` : 'entire organization (set ANTHROPIC_RECONCILE_WORKSPACE_ID to narrow)',
    api_key_ids: keyIds,
    ...cmp,
    anthropic_cost_by_type_usd: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Number(v.toFixed(4))])),
    notes: [
      ...(keyIds.length ? ['With API keys selected, Anthropic\'s dollars are those keys\' tokens priced at our price catalog (the cost report cannot be filtered by key). Our ledger is not split by key, so choose every key the agent and the mail service use.'] : []),
      'Priority Tier costs are not in the cost report.',
      'Today\'s numbers can lag a few minutes behind real usage.',
      'Web search / code execution fees appear in Anthropic cost but not in per-call usage — they show as "under recorded".',
    ],
  };
}
