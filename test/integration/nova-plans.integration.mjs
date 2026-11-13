// Nova plans, volume-discount pricing, custom amounts and the company model screen against a REAL MongoDB (in-memory),
// over HTTP. Not part of `npm test`:
//   npm i --no-save mongodb-memory-server && node test/integration/nova-plans.integration.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${ROOT}/${rel}`).href);
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri('wx_plans');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.WORXSTREAM_BASE_URL = 'http://localhost';
process.env.ADMIN_API_KEY = 'admin-secret';
process.env.NOVA_MARKUP_RATE = '0.2';
const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);
const express = (await import(pathToFileURL(`${ROOT}/node_modules/express/index.js`).href)).default;
await (await imp('src/analytics/ensureIndexes.js')).ensureAnalyticsIndexes();
const { default: agents } = await imp('src/nova/routes/agents.js');
const { default: admin } = await imp('src/analytics/routes/admin.js');
const app = express(); app.use(express.json());
app.use('/api/agents', agents); app.use('/api/admin', admin);
const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const A = { headers: { 'x-admin-api-key': 'admin-secret', 'content-type': 'application/json' } };
const q = 'companyId=42&userId=7&apiToken=t';
const get = (url, init) => fetch(url, init).then((x) => x.json());
const send = (method, url, body) => fetch(url, { ...A, method, body: JSON.stringify(body) });

// 1. defaults seeded; staff see price, credit, bonus, what it covers and the margin
let r = await get(`${base}/admin/analytics/nova-plans`, A);
assert.deepEqual(r.data.plans.map((p) => [p.plan_id, p.price_usd, p.credit_usd]), [['starter', 50, 50], ['growth', 250, 254.24], ['scale', 1000, 1043.48]]);
const scale = r.data.plans.find((p) => p.plan_id === 'scale');
assert.equal(scale.bonus_pct, 4.3);
assert.equal(scale.margin_rate, 0.15);
assert.ok(scale.margin_usd > 0 && scale.anthropic_value_usd > 0);
assert.ok(scale.features.length >= 2);
assert.equal(r.data.usage_markup_rate, 0.2);
assert.equal(r.data.pricing.tiers.length, 3);

// 2. a company sees what it pays and gets, the features and the custom card, never the margin or Anthropic's cost
let c = await get(`${base}/agents/plans?${q}`);
assert.equal(c.data.plans.length, 3);
for (const p of c.data.plans) assert.deepEqual(Object.keys(p).sort(), ['bonus_pct', 'credit_usd', 'description', 'estimated_requests', 'features', 'name', 'plan_id', 'price_usd']);
assert.deepEqual(c.data.custom, { min_usd: 20, max_usd: 10000, bonus_tiers: [{ min_usd: 250, bonus_pct: 1.7 }, { min_usd: 1000, bonus_pct: 4.3 }] });
const text = JSON.stringify(c.data).toLowerCase();
assert.equal(text.includes('margin') || text.includes('anthropic'), false);

// 3. quotes for a custom amount (company) and with the margin (staff / Laravel)
let quote = await get(`${base}/agents/plans/quote?${q}&amount=500`);
assert.deepEqual(Object.keys(quote.data).sort(), ['bonus_pct', 'credit_usd', 'estimated_requests', 'price_usd']);
assert.equal(quote.data.credit_usd, 508.47); // 500 x 1.2 / 1.18
assert.equal((await fetch(`${base}/agents/plans/quote?${q}&amount=5`)).status, 400, 'below the minimum');
assert.equal((await fetch(`${base}/agents/plans/quote?${q}&amount=999999`)).status, 400, 'above the maximum');
quote = await get(`${base}/admin/analytics/nova-plans/quote?amount=500`, A);
assert.equal(quote.data.margin_rate, 0.18);
assert.ok(quote.data.margin_usd > 0);

// 4. staff change the discount rules; the tiers cannot reward a bigger purchase with a higher margin
r = await send('PUT', `${base}/admin/analytics/nova-pricing`, { tiers: [{ min_usd: 0, margin_rate: 0.2 }, { min_usd: 500, margin_rate: 0.15 }] }).then((x) => x.json());
assert.equal(r.data.pricing.tiers.length, 2);
quote = await get(`${base}/agents/plans/quote?${q}&amount=500`);
assert.equal(quote.data.credit_usd, 521.74); // 500 x 1.2 / 1.15
assert.equal((await send('PUT', `${base}/admin/analytics/nova-pricing`, { tiers: [{ min_usd: 0, margin_rate: 0.15 }, { min_usd: 500, margin_rate: 0.2 }] })).status, 400);
await send('PUT', `${base}/admin/analytics/nova-pricing`, { tiers: [{ min_usd: 0, margin_rate: 0.2 }, { min_usd: 250, margin_rate: 0.18 }, { min_usd: 1000, margin_rate: 0.15 }] });

// 5. plans: create with features, edit, hide
r = await send('POST', `${base}/admin/analytics/nova-plans`, { name: 'Nova Team', price_usd: 120, features: 'Line one\nLine two' }).then((x) => x.json());
assert.deepEqual(r.data.features, ['Line one', 'Line two']);
await send('PUT', `${base}/admin/analytics/nova-plans/nova-team`, { active: false });
c = await get(`${base}/agents/plans?${q}`);
assert.equal(c.data.plans.some((p) => p.plan_id === 'nova-team'), false);
assert.equal((await send('POST', `${base}/admin/analytics/nova-plans`, { plan_id: 'starter', name: 'x', price_usd: 5 })).status, 400);
assert.equal((await fetch(`${base}/admin/analytics/nova-plans`)).status, 401);

// 6. purchases: a plan and a custom amount credit the quoted amount, once per payment
const grant = (body) => send('POST', `${base}/admin/analytics/companies/42/wallet/credits`, body).then((x) => x.json());
const g1 = await grant({ plan_id: 'growth', payment_ref: 'pi_plan_1' });
assert.equal(g1.data.purchased_credit_usd, 254.24, 'a $250 plan credits $254.24');
assert.equal(g1.data.plan_name, 'Nova Growth');
assert.equal((await grant({ plan_id: 'growth', payment_ref: 'pi_plan_1' })).data.duplicate, true);
const g2 = await grant({ custom_amount_usd: 1000, payment_ref: 'pi_custom_1' });
assert.equal(g2.data.purchased_credit_usd, 254.24 + 1043.48);
assert.equal(g2.data.plan_name, 'Nova Growth', 'a custom top-up does not change the plan name');
assert.equal((await grant({ custom_amount_usd: 1000, payment_ref: 'pi_custom_1' })).data.duplicate, true);
assert.equal((await fetch(`${base}/admin/analytics/companies/42/wallet/credits`, { ...A, method: 'POST', body: JSON.stringify({ custom_amount_usd: 5, payment_ref: 'x' }) })).status, 400);
const tx = await get(`${base}/agents/wallet/transactions?${q}`);
assert.deepEqual(tx.data.map((t) => [t.plan_name, t.paid_usd, t.amount_usd]), [['Custom amount', 1000, 1043.48], ['Nova Growth', 250, 254.24]]);

// 7. the margin is taken as credit is spent: $1 of provider cost debits $1.20
const { recordUsage } = await imp('src/analytics/recordUsage.js');
const wallet = await imp('src/analytics/novaWallet.js');
const before = (await wallet.getWallet('42')).spent_micros || 0;
await recordUsage({ companyId: '42', userId: '7', agentKey: 'nova' }, { input_tokens: 100000, output_tokens: 20000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, 'claude-sonnet-4-6', 'claude-sonnet-4-6', { messageId: 'm1' });
const spent = ((await wallet.getWallet('42')).spent_micros - before) / 1e6;
const usage = await (await imp('src/analytics/queries.js')).getCompanyUsage('42', {});
assert.ok(Math.abs(spent - usage.totals.cost_usd * 1.2) < 1e-4, `debit ${spent} should be provider ${usage.totals.cost_usd} x 1.2`);

// 8. the model screen: a recommendation per task, charged prices, save and reset
let m = await get(`${base}/agents/company-models?${q}`);
assert.deepEqual(m.data.tasks.map((t) => t.key), ['daily', 'medium']);
for (const t of m.data.tasks) {
  assert.equal(t.options.filter((o) => o.recommended).length, 1);
  assert.equal(t.selected_model_id, t.recommended_model_id);
  assert.equal(t.is_custom, false);
}
const medium = m.data.tasks.find((t) => t.key === 'medium');
const opus = medium.options.find((o) => o.id === 'claude-opus-5-5');
assert.equal(opus.charged_input_per_million, 4.8);
assert.equal(medium.options.length, 4, 'the recommended model is one of the four cards');
assert.equal(JSON.stringify(m.data).includes('inputPerMillion'), false, 'no provider prices');
const pick = medium.options.find((o) => !o.recommended).id;
m = await send('PUT', `${base}/agents/company-models?${q}`, { medium: pick }).then((x) => x.json());
assert.equal(m.data.tasks.find((t) => t.key === 'medium').selected_model_id, pick);
assert.equal(m.data.tasks.find((t) => t.key === 'medium').is_custom, true);
assert.equal((await send('PUT', `${base}/agents/company-models?${q}`, { daily: 'not-a-model' })).status, 400);
m = await send('PUT', `${base}/agents/company-models?${q}`, { medium: '' }).then((x) => x.json());
assert.equal(m.data.tasks.find((t) => t.key === 'medium').is_custom, false, 'an empty value goes back to the recommendation');
const resolved = await (await imp('src/analytics/taskModels.js')).loadTaskModels('42', '7');
assert.equal(resolved.medium, medium.recommended_model_id);

// 9. staff table: which model each company uses per task (companies that only used Nova appear too)
await send('PUT', `${base}/agents/company-models?${q}`, { medium: 'claude-opus-5-5' });
await recordUsage({ companyId: '99', userId: '1', agentKey: 'nova' }, { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, 'claude-sonnet-4-6', 'claude-sonnet-4-6', { messageId: 'm99' });
const table = await get(`${base}/admin/analytics/company-models`, A);
assert.deepEqual(table.data.tasks.map((t) => t.key), ['daily', 'medium']);
const row42 = table.data.companies.find((c) => c.company_id === '42');
assert.equal(row42.tasks.medium.model_id, 'claude-opus-5-5');
assert.equal(row42.tasks.medium.source, 'company');
assert.equal(row42.tasks.daily.source, 'recommended');
assert.equal(row42.plan_name, 'Nova Growth');
const row99 = table.data.companies.find((c) => c.company_id === '99');
assert.ok(row99, 'a company with usage but no wallet is listed');
assert.equal(row99.tasks.medium.source, 'recommended');
assert.equal((await fetch(`${base}/admin/analytics/company-models`)).status, 401);

// 10. plans saved by the earlier design (credit + margin) are converted to a price
const NovaPlan = (await imp('src/analytics/models/NovaPlan.js')).default;
await NovaPlan.collection.insertOne({ plan_id: 'legacy', name: 'Legacy', credit_usd: 75, margin_rate: 0.2, price_usd: 90, active: true, sort: 9, created_at: new Date(), updated_at: new Date() });
const { migrateLegacyNovaPlans } = await imp('src/analytics/novaPlans.js');
assert.equal(await migrateLegacyNovaPlans(), 1);
const legacy = await NovaPlan.collection.findOne({ plan_id: 'legacy' });
assert.equal(legacy.price_usd, 75);
assert.equal('credit_usd' in legacy || 'margin_rate' in legacy, false);
assert.equal(await migrateLegacyNovaPlans(), 0, 'safe to run again');

console.log('nova plans integration: all checks passed');
server.close(); await mongoose.disconnect(); await mongod.stop();
