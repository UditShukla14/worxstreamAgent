// AI apps hub against a REAL MongoDB (in-memory): app wallets, subscriptions, Raven usage metering.
// Not part of `npm test`: npm i --no-save mongodb-memory-server && node test/integration/ai-apps.integration.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${ROOT}/${rel}`).href);

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri('wx_apps');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.WORXSTREAM_BASE_URL = 'http://localhost';
process.env.NOVA_MARKUP_RATE = '0.2';

const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);

const wallet = await imp('src/apps/appWallet.js');
const subs = await imp('src/apps/subscriptions.js');
const { recordRavenUsage } = await imp('src/apps/ravenUsage.js');
const Event = (await imp('src/analytics/models/LlmUsageEvent.js')).default;
const Daily = (await imp('src/analytics/models/LlmUsageDaily.js')).default;
const { getAppsOverview } = await imp('src/apps/overview.js');
await (await imp('src/apps/models/CompanyAppWallet.js')).default.init();
await (await imp('src/apps/models/CompanyAppSubscription.js')).default.init();
await Event.init();

// Raven is off until subscribed
assert.equal((await subs.checkAppAccess('c1', 'raven')).reason, 'not_subscribed');
await subs.setSubscription('c1', 'raven', { status: 'active', plan_name: 'Starter' });
assert.equal((await subs.checkAppAccess('c1', 'raven')).allowed, true, 'active with no wallet = unlimited');

// An allowance turns enforcement on; credit is idempotent per payment_ref
await wallet.setAppAllowance('c1', 'raven', { free_allowance_usd: 1 });
const g1 = await wallet.grantAppCredits('c1', 'raven', { amount_usd: 4, payment_ref: 'pi_1' });
const g2 = await wallet.grantAppCredits('c1', 'raven', { amount_usd: 4, payment_ref: 'pi_1' });
assert.equal(g1.duplicate, false);
assert.equal(g2.duplicate, true);
assert.equal(g2.purchased_credit_usd, 4);
assert.equal((await wallet.getAppWalletView('c1', 'raven')).remaining_usd, 5);

// A reported Raven call is priced, written to the ledger, rolled up under agent_key raven and debited from the Raven wallet
const usage = { input_tokens: 1_000_000, output_tokens: 0 };
const r1 = await recordRavenUsage({ company_id: 'c1', user_id: '7', model: 'claude-haiku-4-5', message_id: 'msg_a', usage });
assert.equal(r1.recorded, true);
const dup = await recordRavenUsage({ company_id: 'c1', user_id: '7', model: 'claude-haiku-4-5', message_id: 'msg_a', usage });
assert.equal(dup.recorded, false, 'the same message id never charges twice');
const ev = await Event.findOne({ idempotency_key: 'msg_a' }).lean();
assert.equal(ev.agent_key, 'raven');
const view = await wallet.getAppWalletView('c1', 'raven');
assert.ok(Math.abs(view.spent_usd - ev.billable_usd) < 1e-9, 'debited by exactly the billable amount');
assert.ok(await Daily.findOne({ company_id: 'c1', user_id: '', agent_key: 'raven', model: '' }), 'rollup under raven');

// Spending the credit blocks Raven; Nova's wallet was never touched
await recordRavenUsage({ company_id: 'c1', user_id: '7', model: 'claude-haiku-4-5', message_id: 'msg_b', usage: { input_tokens: 0, output_tokens: 5_000_000 } });
assert.equal((await subs.checkAppAccess('c1', 'raven')).reason, 'exhausted');
assert.equal((await (await imp('src/analytics/novaWallet.js')).getWallet('c1')), null);

// Pausing blocks it too; the hub overview splits the two apps
await subs.setSubscription('c1', 'raven', { status: 'paused' });
assert.equal((await subs.checkAppAccess('c1', 'raven')).reason, 'paused');
const overview = await getAppsOverview({});
const row = overview.companies.find((c) => c.company_id === 'c1');
assert.ok(row.raven.usage.billable_usd > 0);
assert.equal(row.nova.usage.billable_usd, 0);

console.log('ai-apps integration: OK');
await mongoose.disconnect();
await mongod.stop();
