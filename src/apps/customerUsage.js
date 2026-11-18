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

/** Per-employee totals, biggest user first (rows are the per-user rollup rows of one app). */
export function summarizeUsers(rows) {
  return rows
    .map((r) => ({ user_id: String(r._id), calls: r.call_count || 0, tokens: r.total_tokens || 0, charged_usd: r6(r.billable_usd), active_days: r.active_days || 0, last_active: r.last_active || null }))
    .sort((a, b) => b.charged_usd - a.charged_usd || b.calls - a.calls);
}

/**
 * @param {string} companyId
 * @param {string} app
 * @param {{ from?: string, to?: string, userId?: string }} [q] userId = only that employee's usage (an employee's own view);
 *   without it: the whole company, with the per-employee division in `users`.
 */
export async function getAppUsageForCompany(companyId, app, q = {}) {
  const range = parseDateRange(q.from, q.to);
  const user = q.userId ? String(q.userId) : '';
  const base = { company_id: String(companyId), agent_key: app, model: '', date: { $gte: range.from, $lte: range.to } };
  const sums = { call_count: { $sum: '$call_count' }, total_tokens: { $sum: '$total_tokens' }, billable_usd: { $sum: { $ifNull: ['$billable_usd', '$cost_usd'] } } };
  const [dayRows, userRows] = await Promise.all([
    LlmUsageDaily.aggregate([{ $match: { ...base, user_id: user } }, { $group: { _id: '$date', ...sums } }]),
    user
      ? []
      : LlmUsageDaily.aggregate([
          { $match: { ...base, user_id: { $ne: '' } } },
          { $group: { _id: '$user_id', ...sums, last_active: { $max: '$date' }, active_days: { $sum: { $cond: [{ $gt: ['$call_count', 0] }, 1, 0] } } } },
        ]),
  ]);
  const daily = fillDays(dayRows, range);
  const totals = daily.reduce((a, d) => ({ calls: a.calls + d.calls, tokens: a.tokens + d.tokens, charged_usd: a.charged_usd + d.charged_usd }), { calls: 0, tokens: 0, charged_usd: 0 });
  return { app, scope: user ? 'user' : 'company', from: range.from, to: range.to, totals: { ...totals, charged_usd: r6(totals.charged_usd) }, daily, users: summarizeUsers(userRows) };
}
