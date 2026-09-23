/**
 * Aggregate LLM usage from LlmUsageDaily for admin dashboards.
 */

import LlmUsageDaily from './models/LlmUsageDaily.js';

/**
 * @param {string|undefined} from
 * @param {string|undefined} to
 */
export function parseDateRange(from, to) {
  const end = to ? String(to).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const start = from
    ? String(from).slice(0, 10)
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from: start, to: end };
}

function emptyTotals() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    call_count: 0,
  };
}

function sumRows(rows) {
  const totals = emptyTotals();
  for (const r of rows) {
    totals.input_tokens += r.input_tokens || 0;
    totals.output_tokens += r.output_tokens || 0;
    totals.cache_creation_input_tokens += r.cache_creation_input_tokens || 0;
    totals.cache_read_input_tokens += r.cache_read_input_tokens || 0;
    totals.total_tokens += r.total_tokens || 0;
    totals.cost_usd += r.cost_usd || 0;
    totals.call_count += r.call_count || 0;
  }
  totals.cost_usd = Number(totals.cost_usd.toFixed(6));
  return totals;
}

/**
 * Platform overview: totals + top companies.
 */
export async function getOverview({ from, to, limit = 20 } = {}) {
  const range = parseDateRange(from, to);
  const match = {
    user_id: '',
    date: { $gte: range.from, $lte: range.to },
  };

  const rows = await LlmUsageDaily.find(match).lean();
  const byCompany = new Map();
  for (const r of rows) {
    const prev = byCompany.get(r.company_id) || emptyTotals();
    byCompany.set(r.company_id, sumRows([prev, r]));
  }

  const companies = [...byCompany.entries()]
    .map(([company_id, totals]) => ({ company_id, ...totals }))
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, Math.min(100, Math.max(1, Number(limit) || 20)));

  return {
    from: range.from,
    to: range.to,
    totals: sumRows(rows),
    companies,
  };
}

/**
 * List companies with usage in range.
 */
export async function listCompanies({ from, to } = {}) {
  const overview = await getOverview({ from, to, limit: 500 });
  return {
    from: overview.from,
    to: overview.to,
    companies: overview.companies,
  };
}

/**
 * Company totals + per-user breakdown (+ optional daily series).
 */
export async function getCompanyUsage(companyId, { from, to, groupBy } = {}) {
  const range = parseDateRange(from, to);
  const cid = String(companyId);

  const companyRows = await LlmUsageDaily.find({
    company_id: cid,
    user_id: '',
    date: { $gte: range.from, $lte: range.to },
  })
    .sort({ date: 1 })
    .lean();

  const userRows = await LlmUsageDaily.find({
    company_id: cid,
    user_id: { $ne: '' },
    date: { $gte: range.from, $lte: range.to },
  }).lean();

  const byUser = new Map();
  for (const r of userRows) {
    const prev = byUser.get(r.user_id) || emptyTotals();
    byUser.set(r.user_id, sumRows([prev, r]));
  }

  const users = [...byUser.entries()]
    .map(([user_id, totals]) => ({ user_id, ...totals }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  const result = {
    company_id: cid,
    from: range.from,
    to: range.to,
    totals: sumRows(companyRows),
    users,
  };

  if (groupBy === 'day') {
    result.daily = companyRows.map((r) => ({
      date: r.date,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_creation_input_tokens: r.cache_creation_input_tokens,
      cache_read_input_tokens: r.cache_read_input_tokens,
      total_tokens: r.total_tokens,
      cost_usd: Number((r.cost_usd || 0).toFixed(6)),
      call_count: r.call_count,
    }));
  }

  return result;
}

/**
 * User totals + daily series for one company user.
 */
export async function getUserUsage(companyId, userId, { from, to } = {}) {
  const range = parseDateRange(from, to);
  const cid = String(companyId);
  const uid = String(userId);

  const rows = await LlmUsageDaily.find({
    company_id: cid,
    user_id: uid,
    date: { $gte: range.from, $lte: range.to },
  })
    .sort({ date: 1 })
    .lean();

  return {
    company_id: cid,
    user_id: uid,
    from: range.from,
    to: range.to,
    totals: sumRows(rows),
    daily: rows.map((r) => ({
      date: r.date,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_creation_input_tokens: r.cache_creation_input_tokens,
      cache_read_input_tokens: r.cache_read_input_tokens,
      total_tokens: r.total_tokens,
      cost_usd: Number((r.cost_usd || 0).toFixed(6)),
      call_count: r.call_count,
    })),
  };
}
