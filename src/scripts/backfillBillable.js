/**
 * Backfill the billable amount (provider cost x (1 + markup)) on usage records created before billable amounts existed.
 * Those rows are counted at cost (0% markup) in reports and invoices. This only fills the customer-facing billable fields:
 *   - llm_usage_events:  markup_rate, billable_micros, billable_usd (provider_cost_micros if it was never stored)
 *   - llm_usage_daily:   billable_micros, billable_usd
 * It never changes what Anthropic charged (cost_usd, token counts) and it does NOT touch any wallet balance or ledger of
 * credits: customers' wallets were debited at the old amount, so a backfilled invoice will be higher than what their credit
 * already paid. Idempotent: only rows with no billable_micros are touched, so a second run changes nothing.
 *
 * The markup is each company's current effective rate for the app (wallet override, else NOVA_MARKUP_RATE / RAVEN_MARKUP_RATE).
 * Daily rows with no agent are treated as Nova (Raven rows always carry an agent key).
 *
 * Usage (from agent/):
 *   node src/scripts/backfillBillable.js                      dry run: shows what would change
 *   node src/scripts/backfillBillable.js --apply              writes it
 *   node src/scripts/backfillBillable.js --company=30000000021 --from=2026-10-01 --to=2026-11-25 [--apply]
 */

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../db/connection.js';
import { resolveMarkupRate } from '../analytics/novaWallet.js';
import { resolveAppMarkup } from '../apps/appWallet.js';
import { appForAgentKey } from '../apps/registry.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const APPLY = process.argv.includes('--apply');
const onlyCompany = arg('company');
const from = arg('from');
const to = arg('to');

const costMicros = { $cond: [{ $gt: [{ $ifNull: ['$provider_cost_micros', 0] }, 0] }, '$provider_cost_micros', { $round: [{ $multiply: [{ $ifNull: ['$cost_usd', 0] }, 1e6] }, 0] }] };

/** Update pipeline: store the provider cost if missing, then the billable fields at `rate`. */
const pipeline = (rate, { withRate }) => [
  { $set: { provider_cost_micros: costMicros } },
  { $set: { billable_micros: { $round: [{ $multiply: ['$provider_cost_micros', 1 + rate] }, 0] }, ...(withRate ? { markup_rate: rate } : {}) } },
  { $set: { billable_usd: { $divide: ['$billable_micros', 1e6] } } },
];

async function backfill(collection, label, { withRate, dateField }) {
  const base = { billable_micros: { $exists: false }, company_id: { $ne: '_unattributed' } };
  if (onlyCompany) base.company_id = onlyCompany;
  if (from || to) base[dateField.name] = { ...(from ? { $gte: dateField.value(from) } : {}), ...(to ? { $lte: dateField.value(to, true) } : {}) };

  const companies = await collection.distinct('company_id', base);
  let rows = 0;
  let cost = 0;
  let billable = 0;
  const perCompany = [];
  for (const companyId of companies) {
    const keys = await collection.distinct('agent_key', { ...base, company_id: companyId });
    const byApp = { nova: [], raven: [] };
    for (const k of keys) byApp[appForAgentKey(k)].push(k);
    for (const app of ['nova', 'raven']) {
      if (!byApp[app].length) continue;
      const rate = app === 'nova' ? await resolveMarkupRate(companyId) : await resolveAppMarkup(companyId, app);
      // '' (no agent) and missing agent keys are Nova.
      const agentFilter = app === 'nova' ? { $or: [{ agent_key: { $in: byApp.nova } }, { agent_key: { $exists: false } }] } : { agent_key: { $in: byApp.raven } };
      const filter = { ...base, company_id: companyId, ...agentFilter };
      const [sum] = await collection.aggregate([{ $match: filter }, { $group: { _id: null, n: { $sum: 1 }, cost: { $sum: costMicros } } }]).toArray();
      if (!sum) continue;
      rows += sum.n;
      cost += sum.cost / 1e6;
      billable += (sum.cost / 1e6) * (1 + rate);
      perCompany.push({ company: companyId, app, rows: sum.n, cost: +(sum.cost / 1e6).toFixed(2), markup: `${(rate * 100).toFixed(1)}%`, adds: +((sum.cost / 1e6) * rate).toFixed(2) });
      if (APPLY) await collection.updateMany(filter, pipeline(rate, { withRate }));
    }
  }
  console.log(`\n${label}: ${rows} rows without a billable amount, cost $${cost.toFixed(2)} -> billable $${billable.toFixed(2)} (adds $${(billable - cost).toFixed(2)})`);
  if (perCompany.length) console.table(perCompany);
}

async function main() {
  await connectDB();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (add --apply to write)'} on database "${mongoose.connection.name}"${onlyCompany ? ` for company ${onlyCompany}` : ''}${from || to ? ` ${from || ''}..${to || ''}` : ''}`);
  const db = mongoose.connection.db;
  await backfill(db.collection('llm_usage_events'), 'events', { withRate: true, dateField: { name: 'created_at', value: (d, end) => new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) } });
  await backfill(db.collection('llm_usage_daily'), 'daily rollups', { withRate: false, dateField: { name: 'date', value: (d) => d } });
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('backfill failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
