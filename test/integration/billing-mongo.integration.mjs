// Integration check for wallet/billing/admin queries against a REAL MongoDB (in-memory).
// Not part of `npm test` (needs a ~100MB mongod download): npm i --no-save mongodb-memory-server && node test/integration/billing-mongo.integration.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${ROOT}/${rel}`).href);

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri('wx_test');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.WORXSTREAM_BASE_URL = 'http://localhost';
process.env.NOVA_MARKUP_RATE = '0.2';

const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);

const wallet = await imp('src/analytics/novaWallet.js');
const { recordUsage } = await imp('src/analytics/recordUsage.js');
const q = await imp('src/analytics/adminQueries.js');
const W = (await imp('src/analytics/models/CompanyNovaWallet.js')).default;
const E = (await imp('src/analytics/models/LlmUsageEvent.js')).default;
await E.init(); await W.init();

// 1. legacy wallet → migration
await W.collection.insertOne({ company_id: 'c1', limits_enabled: true, free_allowance_usd: 5, purchased_credit_usd: 2, spent_usd: 1.234567 });
assert.equal(await wallet.migrateWalletMicros(), 1);
let d = await W.findOne({ company_id: 'c1' }).lean();
assert.deepEqual([d.free_allowance_micros, d.purchased_credit_micros, d.spent_micros], [5_000_000, 2_000_000, 1_234_567]);
assert.equal(await wallet.migrateWalletMicros(), 0, 'idempotent');

// 2. atomic integer debits, mirror derived
for (let i = 0; i < 3; i++) await wallet.incrementWalletSpent('c1', 0.000181);
d = await W.findOne({ company_id: 'c1' }).lean();
assert.equal(d.spent_micros, 1_234_567 + 543);
assert.equal(d.spent_usd, (1_234_567 + 543) / 1e6);

// concurrency: 200 parallel debits of 1µ$ lose nothing
await Promise.all(Array.from({ length: 200 }, () => wallet.incrementWalletSpent('c1', 0.000001)));
d = await W.findOne({ company_id: 'c1' }).lean();
assert.equal(d.spent_micros, 1_234_567 + 543 + 200);

// 3. grant (existing + new/upsert)
const g1 = await wallet.grantWalletCredits('c1', { amount_usd: 10, reason: 'top-up', payment_ref: 'inv_1' });
assert.equal(g1.purchased_credit_usd, 12);
const g2 = await wallet.grantWalletCredits('c2', { amount_usd: 4.5 });
assert.equal(g2.purchased_credit_usd, 4.5);
assert.equal(g2.enforced, true);
d = await W.findOne({ company_id: 'c1' }).lean();
assert.match(d.notes, /top-up/);
assert.equal(d.spent_micros, 1_234_567 + 543 + 200, 'grant must not change spent');

// 4. allowance + markup + display name (upsert, no $set/$setOnInsert conflicts)
const s3 = await wallet.setWalletAllowance('c3', { free_allowance_usd: 3, markup_rate: 0.3, display_name: 'Acme Ltd' });
assert.equal(s3.free_allowance_usd, 3);
assert.equal((await wallet.getWalletStatus('c3')).markup_rate, 0.3);
assert.equal((await wallet.getWalletStatus('c3')).display_name, 'Acme Ltd');
await wallet.setWalletAllowance('c4', { display_name: 'No-wallet-yet' }); // upsert without allowance
assert.equal((await wallet.getWallet('c4')).limits_enabled, false);

// 5. usage events: markup, idempotency, unattributed
const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 500_000, cache_creation_input_tokens: 200_000 };
const before = (await W.findOne({ company_id: 'c1' }).lean()).spent_micros;
const ev = await recordUsage({ companyId: 'c1', userId: 'u1', phase: 'agent', agentKey: 'nova', conversationId: 'conv1' }, usage, 'claude-sonnet-4-6', 'claude-sonnet-4-6', { messageId: 'msg_1' });
assert.equal(ev.provider_cost_micros, 5_400_000);
assert.equal(ev.billable_micros, 6_480_000);
assert.equal(ev.markup_rate, 0.2);
const dup = await recordUsage({ companyId: 'c1', userId: 'u1', phase: 'agent', agentKey: 'nova' }, usage, 'claude-sonnet-4-6', 'claude-sonnet-4-6', { messageId: 'msg_1' });
assert.equal(dup, null, 'duplicate message id must not be billed twice');
assert.equal(await E.countDocuments({ idempotency_key: 'msg_1' }), 1);
const after = (await W.findOne({ company_id: 'c1' }).lean()).spent_micros;
assert.equal(after - before, 6_480_000);
assert.equal((await E.findOne({ idempotency_key: 'msg_1' }).lean()).wallet_applied, true);

// per-company markup override (c3 = 0.3) + second user + other agent/model
await recordUsage({ companyId: 'c3', userId: 'u9', phase: 'agent', agentKey: 'invoice' }, { input_tokens: 1_000_000 }, 'claude-haiku-4-5', '', { messageId: 'msg_2' });
await new Promise((r) => setTimeout(r, 100));
const c3 = await E.findOne({ idempotency_key: 'msg_2' }).lean();
assert.equal(c3.markup_rate, 0.3);
assert.equal(c3.billable_micros, 1_300_000);
await recordUsage({ companyId: 'c1', userId: 'u2', phase: 'router', agentKey: 'router' }, { input_tokens: 5000, output_tokens: 50 }, 'claude-haiku-4-5', '', { messageId: 'msg_3' });
const un = await recordUsage({ phase: 'agent' }, { input_tokens: 1000 }, 'claude-haiku-4-5', '', { messageId: 'msg_4' });
assert.equal(un.unattributed, true);

// 6. reconcile wallet vs ledger
let rec = await wallet.reconcileWalletFromLedger('c1');
console.log('reconcile c1 (manual spent set earlier → drift expected):', rec.drift_usd);
rec = await wallet.reconcileWalletFromLedger('c1', { apply: true });
rec = await wallet.reconcileWalletFromLedger('c1');
assert.equal(rec.drift_micros, 0);

// 7. admin queries
const sum = await q.getSummary({ from: '2020-01-01', to: new Date().toISOString().slice(0, 10) });
console.log('summary kpis', JSON.stringify(sum.kpis));
assert.ok(sum.kpis.billable_usd > sum.kpis.cost_usd);
assert.equal(sum.kpis.active_companies, 2);
assert.equal(sum.alerts.unattributed_calls, 1);
const byDate = await q.getUsage({ from: '2020-01-01', group_by: 'date' });
assert.ok(byDate.rows.length >= 1);
const byUser = await q.getUsage({ from: '2020-01-01', company_id: 'c1', group_by: 'user' });
assert.deepEqual(byUser.rows.map((r) => r.user_id).sort(), ['u1', 'u2']);
const byAgentModel = await q.getUsage({ from: '2020-01-01', group_by: 'agent,model' });
assert.ok(byAgentModel.rows.some((r) => r.agent_key === 'nova' && r.model === 'claude-sonnet-4-6'));
const filtered = await q.getUsage({ from: '2020-01-01', company_id: 'c1', user_id: 'u1', group_by: 'date' });
assert.equal(filtered.totals.call_count, 1);
const dir = await q.getDirectory({ from: '2020-01-01' });
console.log('directory', dir.companies.map((c) => [c.company_id, c.display_name, c.users, c.billable_usd, c.wallet?.status]));
assert.equal(dir.companies.find((c) => c.company_id === 'c3').display_name, 'Acme Ltd');
const det = await q.getCompanyDetail('c1', { from: '2020-01-01' });
assert.equal(det.users.length, 2);
assert.equal(det.wallet.exists, true);
const wl = await wallet.listWallets();
console.log('wallets', wl.map((w) => [w.company_id, w.status, w.remaining_usd]));

// 8. insights (economics / growth / quality / wallets runway / models)
const insights = await imp('src/analytics/adminInsights.js');
const Turn = (await imp('src/nova/models/ConversationTurn.js')).default;
const now = new Date();
const mkTurn = (i, over = {}) => ({
  company_id: 'c1', user_id: 'u1', conversation_id: `cv${i}`, turn_index: 0, turn_id: `t${i}`, user: { content: 'hi' }, created_at: now,
  log: { status: 'completed', tools: [{ tool: 'list_invoices', ok: true }, { tool: 'get_customer', ok: i % 2 === 0 }], duration_ms: 1000 + i * 500,
    usage: { turn_cost_usd: 0.01 * (i + 1), total_tokens: 1000 * (i + 1), spend_cap_hit: i === 4,
      context: { used_tokens: i === 3 ? 140_000 : 20_000, used_pct_of_budget: i === 3 ? 93 : 13, thresholds: { soft: 97_500, hard: 127_500 }, history_turns_dropped: i === 3 ? 2 : 0, tool_results_cleared: i === 3 ? 4 : 0 } }, ...(over.log || {}) },
  ...over,
});
await Turn.insertMany([0, 1, 2, 3, 4].map((i) => mkTurn(i)).concat([mkTurn(5, { log: { status: 'error', tools: [], usage: {} } })]));
const FROM = '2020-01-01';
const eco = await insights.getEconomics({ from: FROM });
assert.ok(eco.unit.revenue_per_turn > 0 && eco.unit.turns === 6);
assert.ok(eco.concentration.top1_pct > 0 && eco.concentration.top1_pct <= 100);
assert.ok(eco.cache.net_saved_usd > 0, 'caching saved money in the seeded usage');
assert.equal(eco.runrate.days_in_month >= 28, true);
assert.ok(eco.models.some((m) => m.model === 'claude-sonnet-4-6'));
const gro = await insights.getGrowth({ from: FROM });
assert.ok(gro.counts.onboarded_companies >= 3);
assert.ok(gro.counts.activation_rate_pct > 0);
assert.ok(gro.stickiness.mau >= 3);
assert.ok(Array.isArray(gro.cumulative) && gro.cumulative.length > 0);
const qual = await insights.getQuality({ from: FROM });
assert.equal(qual.turns, 6);
assert.equal(qual.outcomes.error, 1);
assert.equal(qual.outcomes.spend_cap_hits, 1);
assert.equal(qual.latency.available, true);
assert.ok(qual.latency.p50_ms >= 1000 && qual.latency.p95_ms >= qual.latency.p50_ms);
const gc = qual.tools.find((t) => t.tool === 'get_customer');
assert.equal(gc.calls, 5); assert.equal(gc.failures, 2);
assert.equal(qual.expensive_turns[0].conversation_id, 'cv4');
assert.equal(qual.context.over_hard, 1);
assert.equal(qual.context.history_trimmed, 1);
await wallet.setWalletAllowance('c1', { seats: 10 });
const gro2 = await insights.getGrowth({ from: FROM });
assert.equal(gro2.adoption.find((a) => a.company_id === 'c1').seats, 10);
const wi = await insights.getWalletsInsights();
assert.ok(wi.wallets.every((w) => 'runway_days' in w));
assert.ok(wi.summary.outstanding_credit_usd > 0);
const mo = await insights.getModelsOverview({ from: FROM });
const sonnet = mo.models.find((m) => m.id === 'claude-sonnet-4-6');
assert.equal(sonnet.input_per_million, 3);
assert.equal(sonnet.customer_input_per_million, 3.6);
assert.ok(sonnet.context_window > 0 && sonnet.max_output > 0);
console.log('insights ok:', JSON.stringify({ runrate: eco.runrate, unit: eco.unit, conc: eco.concentration.top1_pct, stick: gro.stickiness.dau_mau_pct, lat: [qual.latency.p50_ms, qual.latency.p95_ms] }));

console.log('ALL INTEGRATION CHECKS PASSED');
await mongoose.disconnect();
await mongod.stop();
process.exit(0);
