/**
 * Customer-facing view of usage. The admin queries carry both Anthropic's cost and the billable amount;
 * a company only ever sees what it is charged, under the name `cost_usd`, and never the provider cost.
 */

const stripRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { billable_usd, ...rest } = row;
  return { ...rest, cost_usd: Number((billable_usd ?? row.cost_usd ?? 0).toFixed(6)) };
};

/** @param {object} usage result of getCompanyUsage / getUserUsage */
export function toCustomerUsage(usage) {
  if (!usage || typeof usage !== 'object') return usage;
  const out = { ...usage };
  if (out.totals) out.totals = stripRow(out.totals);
  for (const key of ['users', 'agents', 'models', 'daily']) {
    if (Array.isArray(out[key])) out[key] = out[key].map(stripRow);
  }
  return out;
}
