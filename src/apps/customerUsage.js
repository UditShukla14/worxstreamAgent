/**
 * What a company sees of its Raven usage: mails analysed and what they cost it (the billable amount, never Anthropic's cost),
 * per day for a range. Raven's rows in the usage rollup are the ones with agent_key "raven".
 */
import LlmUsageDaily from '../analytics/models/LlmUsageDaily.js';
import { parseDateRange } from '../analytics/queries.js';

const dayMs = 86_400_000;
const r6 = (n) => Number((n || 0).toFixed(6));

/** One row per day of the range (zeros for quiet days), so a chart has no gaps. */
export function fillDays(rows, range) {
  const by = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let t = Date.parse(`${range.from}T00:00:00Z`); t <= Date.parse(`${range.to}T00:00:00Z`); t += dayMs) {
    const date = new Date(t).toISOString().slice(0, 10);
    const r = by.get(date);
    out.push({ date, calls: r?.call_count || 0, tokens: r?.total_tokens || 0, charged_usd: r6(r?.billable_usd) });
  }
  return out;
}

/** @param {string} companyId @param {{ from?: string, to?: string }} [q] */
export async function getAppUsageForCompany(companyId, app, q = {}) {
  const range = parseDateRange(q.from, q.to);
  const rows = await LlmUsageDaily.aggregate([
    { $match: { company_id: String(companyId), user_id: '', agent_key: app, model: '', date: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: '$date', call_count: { $sum: '$call_count' }, total_tokens: { $sum: '$total_tokens' }, billable_usd: { $sum: { $ifNull: ['$billable_usd', '$cost_usd'] } } } },
  ]);
  const daily = fillDays(rows, range);
  const totals = daily.reduce((a, d) => ({ calls: a.calls + d.calls, tokens: a.tokens + d.tokens, charged_usd: a.charged_usd + d.charged_usd }), { calls: 0, tokens: 0, charged_usd: 0 });
  return { app, from: range.from, to: range.to, totals: { ...totals, charged_usd: r6(totals.charged_usd) }, daily };
}
