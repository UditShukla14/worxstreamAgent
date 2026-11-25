/**
 * Usage invoice for a company over a date range, generated on demand by staff (the Reconcile page). It lists, per day, what
 * the company was charged for Nova and for Raven (the ledger's BILLABLE amounts, which already include the markup) and the
 * total. Anthropic's cost, the markup and the margin are never shown. Nothing is stored: the same range always gives the
 * same numbers, because they come from the usage rollups.
 */
import LlmUsageDaily from '../analytics/models/LlmUsageDaily.js';
import { parseDateRange } from '../analytics/queries.js';
import { appForAgentKey } from '../apps/registry.js';
import { renderInvoiceDocument, esc } from './invoiceTheme.js';
import { UNATTRIBUTED } from '../analytics/recordUsage.js';

const dayMs = 86_400_000;
export const MAX_INVOICE_DAYS = 366;

const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const dateLong = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const tokens = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
const r6 = (n) => Number((n || 0).toFixed(6));

/** The billable amount of a rollup row in dollars (legacy rows without billable fields count at their cost). */
export const billableOf = (row) => (row.billable_micros != null ? row.billable_micros / 1e6 : (row.billable_usd ?? row.cost_usd ?? 0));

/**
 * Pure: the company's per-agent day rows -> one row per day with Nova, Raven and total, and the period totals.
 * Days with nothing are left out of the table.
 * @param {Array<{ date: string, agent_key: string, call_count?: number, billable_micros?: number, billable_usd?: number, cost_usd?: number }>} rows
 */
export function foldInvoiceDays(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = byDay.get(r.date) || { date: r.date, nova_usd: 0, raven_usd: 0, calls: 0, tokens: 0 };
    const amount = billableOf(r);
    if (appForAgentKey(r.agent_key) === 'raven') day.raven_usd += amount;
    else day.nova_usd += amount;
    day.calls += r.call_count || 0;
    day.tokens += r.total_tokens || 0;
    byDay.set(r.date, day);
  }
  const days = [...byDay.values()]
    .map((d) => ({ ...d, nova_usd: r6(d.nova_usd), raven_usd: r6(d.raven_usd), total_usd: r6(d.nova_usd + d.raven_usd) }))
    .filter((d) => d.total_usd > 0 || d.calls > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = days.reduce((a, d) => ({ nova_usd: a.nova_usd + d.nova_usd, raven_usd: a.raven_usd + d.raven_usd, calls: a.calls + d.calls, tokens: a.tokens + d.tokens }), { nova_usd: 0, raven_usd: 0, calls: 0, tokens: 0 });
  return { days, totals: { nova_usd: r6(totals.nova_usd), raven_usd: r6(totals.raven_usd), calls: totals.calls, tokens: totals.tokens, total_usd: r6(totals.nova_usd + totals.raven_usd) } };
}

/** Companies with something to invoice in the range, biggest first (for the company picker). */
export async function listInvoiceableCompanies({ from, to } = {}) {
  const range = parseDateRange(from, to);
  const rows = await LlmUsageDaily.aggregate([
    { $match: { user_id: '', agent_key: '', model: '', date: { $gte: range.from, $lte: range.to }, company_id: { $ne: UNATTRIBUTED } } },
    { $group: { _id: '$company_id', billable_micros: { $sum: { $ifNull: ['$billable_micros', { $multiply: [{ $ifNull: ['$billable_usd', '$cost_usd'] }, 1e6] }] } }, calls: { $sum: '$call_count' } } },
    { $match: { billable_micros: { $gt: 0 } } },
    { $sort: { billable_micros: -1 } },
  ]);
  return rows.map((r) => ({ company_id: r._id, billable_usd: r6(r.billable_micros / 1e6), calls: r.calls }));
}

/** The data of one company's invoice for the range. */
export async function getUsageInvoiceData({ companyId, from, to, companyName = '' }) {
  const range = parseDateRange(from, to);
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMs) + 1;
  if (days > MAX_INVOICE_DAYS) throw new Error(`Range too large (max ${MAX_INVOICE_DAYS} days)`);
  if (!String(companyId || '').trim()) throw new Error('company_id is required');
  const rows = await LlmUsageDaily.find({
    company_id: String(companyId),
    user_id: '',
    model: '',
    agent_key: { $ne: '' },
    date: { $gte: range.from, $lte: range.to },
  }).lean();
  const { days: lines, totals } = foldInvoiceDays(rows);
  return { company_id: String(companyId), company_name: companyName, from: range.from, to: range.to, lines, totals };
}

/** Stable number: the company and the period. */
export const usageInvoiceNumber = (d) => `WXU-${d.company_id}-${d.from.replace(/-/g, '')}-${d.to.replace(/-/g, '')}`;

/**
 * @param {ReturnType<typeof getUsageInvoiceData> extends Promise<infer T> ? T : never} d
 * @param {{ name: string, address?: string, tax_id?: string }} seller
 * @param {{ generatedAt?: Date }} [opts]
 */
export function renderUsageInvoiceHtml(d, seller, { generatedAt = new Date() } = {}) {
  const number = usageInvoiceNumber(d);
  const total = usd(d.totals.total_usd);
  const issued = dateLong(generatedAt.toISOString().slice(0, 10));
  const period = `${dateLong(d.from)} to ${dateLong(d.to)}`;
  const body = `
  <table class="items">
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
    <tbody><tr>
      <td><div style="font-weight:600">AI credit usage</div><div class="muted small">${esc(period)}</div></td>
      <td class="r num">1</td><td class="r num">${esc(total)}</td><td class="r num">${esc(total)}</td>
    </tr></tbody>
    <tfoot>
      <tr><td colspan="2"></td><td class="l">Subtotal</td><td class="r num">${esc(total)}</td></tr>
      <tr><td colspan="2"></td><td class="l">Total</td><td class="r num">${esc(total)}</td></tr>
      <tr class="strong"><td colspan="2"></td><td class="l">Amount due</td><td class="r num">${esc(total)}</td></tr>
    </tfoot>
  </table>
  <h2>Usage detail</h2>
  <table class="items">
    <thead><tr><th>Date (UTC)</th><th class="r">Tokens</th><th class="r">Amount charged</th></tr></thead>
    <tbody>${d.lines.length
      ? d.lines.map((l) => `<tr><td>${esc(dateLong(l.date))}</td><td class="r num">${esc(tokens(l.tokens))}</td><td class="r num">${esc(usd(l.total_usd))}</td></tr>`).join('')
      : '<tr><td colspan="3" class="muted">No usage in this period.</td></tr>'}</tbody>
    <tfoot><tr class="strong"><td>Total</td><td class="r num">${esc(tokens(d.totals.tokens))}</td><td class="r num">${esc(total)}</td></tr></tfoot>
  </table>`;
  return renderInvoiceDocument({
    title: 'Invoice', number, seller, billTo: { name: d.company_name || `Company ${d.company_id}`, id: d.company_id },
    issued, due: 'On receipt', headline: `${esc(total)} <span class="muted">due on receipt</span>`, body,
  });
}
