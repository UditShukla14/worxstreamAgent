// Real-MongoDB check of Stripe settlement (in-memory). Not part of `npm test`: npm i --no-save mongodb-memory-server && node test/integration/stripe-checkout.integration.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${ROOT}/${rel}`).href);

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri('wx_test');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.WORXSTREAM_BASE_URL = 'http://localhost';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);

const { ensureAnalyticsIndexes } = await imp('src/analytics/ensureIndexes.js');
await ensureAnalyticsIndexes();
const { settleNovaPayment, priceNovaPurchase } = await imp('src/billing/stripe/novaCheckout.js');
const { getWallet, listWalletTransactions } = await imp('src/analytics/novaWallet.js');

// pricing comes from the server
const plans = await (await imp('src/analytics/novaPlans.js')).listNovaPlans();
const plan = plans.find((p) => p.price_usd === 250) || plans[0];
const priced = await priceNovaPurchase({ plan_id: plan.plan_id });
assert.equal(priced.price_usd, plan.price_usd);
await assert.rejects(() => priceNovaPurchase({ custom_amount_usd: 1 }), /between/);
await assert.rejects(() => priceNovaPurchase({ plan_id: 'nope' }), /not found/);

const intent = { id: 'pi_test_1', status: 'succeeded', amount: priced.price_usd * 100, amount_received: priced.price_usd * 100, metadata: { kind: 'nova_credits', company_id: 'c1', user_id: 'u1', plan_id: plan.plan_id, custom_amount_usd: '' } };
const first = await settleNovaPayment(intent);
assert.equal(first.credited, true);
const second = await settleNovaPayment(intent); // webhook retry / confirm endpoint after the webhook
assert.equal(second.credited, false);
assert.equal(second.duplicate, true);

const w = await getWallet('c1');
assert.equal(w.purchased_credit_usd, priced.credit_usd);
const tx = await listWalletTransactions('c1');
assert.equal(tx.length, 1);
assert.equal(tx[0].payment_ref, 'pi_test_1');
assert.equal(tx[0].paid_usd, priced.price_usd);

// custom amount
const custom = { id: 'pi_test_2', status: 'succeeded', amount: 30000, amount_received: 30000, metadata: { kind: 'nova_credits', company_id: 'c1', plan_id: '', custom_amount_usd: '300' } };
assert.equal((await settleNovaPayment(custom)).credited, true);
assert.equal((await listWalletTransactions('c1')).length, 2);

// chargebacks
const { handleDisputeCreated, handleDisputeClosed } = await imp('src/billing/stripe/disputes.js');
const before = (await getWallet('c1')).purchased_credit_usd;
const dispute = { id: 'du_1', status: 'needs_response', payment_intent: 'pi_test_1', amount: priced.price_usd * 100 };
assert.equal((await handleDisputeCreated({ ...dispute, status: 'warning_needs_response' })).handled, false); // inquiry moves no money
assert.equal((await handleDisputeCreated({ ...dispute, payment_intent: 'pi_unknown' })).handled, false);
assert.equal((await handleDisputeCreated(dispute)).handled, true);
assert.equal((await handleDisputeCreated(dispute)).handled, false); // Stripe retry
assert.ok(Math.abs((await getWallet('c1')).purchased_credit_usd - (before - priced.credit_usd)) < 1e-6);
const rows = await listWalletTransactions('c1');
assert.equal(rows.find((r) => r.type === 'reversal').amount_usd, -priced.credit_usd);
assert.equal((await handleDisputeClosed({ ...dispute, status: 'lost' })).handled, false); // lost: stays removed
assert.equal((await handleDisputeClosed({ ...dispute, status: 'won' })).handled, true);
assert.equal((await handleDisputeClosed({ ...dispute, status: 'won' })).handled, false);
assert.ok(Math.abs((await getWallet('c1')).purchased_credit_usd - before) < 1e-6);
// partial dispute takes back the same share of the credit
const beforePartial = (await getWallet('c1')).purchased_credit_usd;
const customCredit = (await priceNovaPurchase({ custom_amount_usd: 300 })).credit_usd;
await handleDisputeCreated({ id: 'du_2', status: 'needs_response', payment_intent: 'pi_test_2', amount: 15000 });
assert.ok(Math.abs(beforePartial - (await getWallet('c1')).purchased_credit_usd - customCredit / 2) < 1e-6);

console.log('stripe-checkout integration: ok');
await mongoose.disconnect();
await mongod.stop();
