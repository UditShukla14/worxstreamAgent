// Wallet ledger / idempotency / trial / low-balance / turn cap against a REAL MongoDB (in-memory).
// Not part of `npm test`: npm i --no-save mongodb-memory-server && node test/integration/wallet-ledger.integration.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${ROOT}/${rel}`).href);

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri('wx_wallet');
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.WORXSTREAM_BASE_URL = 'http://localhost';
process.env.NOVA_MARKUP_RATE = '0.25';
process.env.NOVA_TRIAL_ALLOWANCE_USD = '5';

const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);

const wallet = await imp('src/analytics/novaWallet.js');
const W = (await imp('src/analytics/models/CompanyNovaWallet.js')).default;
const T = (await imp('src/analytics/models/WalletTransaction.js')).default;
await W.init(); await T.init();

// 1. a grant with a payment_ref credits once; retries (even concurrent) change nothing
const first = await wallet.grantWalletCredits('c1', { amount_usd: 50, reason: 'pack anth_50', payment_ref: 'pi_1' });
assert.equal(first.duplicate, false);
assert.equal(first.purchased_credit_usd, 50);
const retry = await wallet.grantWalletCredits('c1', { amount_usd: 50, reason: 'pack anth_50', payment_ref: 'pi_1' });
assert.equal(retry.duplicate, true);
assert.equal(retry.purchased_credit_usd, 50, 'a retried webhook must not credit twice');
const burst = await Promise.all(Array.from({ length: 50 }, () => wallet.grantWalletCredits('c1', { amount_usd: 50, payment_ref: 'pi_1' })));
assert.ok(burst.every((r) => r.duplicate === true));
assert.equal((await wallet.getWallet('c1')).purchased_credit_micros, 50_000_000);
// a different ref credits; the same ref on another company credits that company
await wallet.grantWalletCredits('c1', { amount_usd: 10, payment_ref: 'pi_2' });
assert.equal((await wallet.getWallet('c1')).purchased_credit_micros, 60_000_000);
const other = await wallet.grantWalletCredits('c2', { amount_usd: 7, payment_ref: 'pi_1' });
assert.equal(other.duplicate, false);
// no ref = ops top-up, always applies
await wallet.grantWalletCredits('c1', { amount_usd: 1, reason: 'goodwill' });
await wallet.grantWalletCredits('c1', { amount_usd: 1, reason: 'goodwill' });
assert.equal((await wallet.getWallet('c1')).purchased_credit_micros, 62_000_000);
// grant_refs never leaks to clients
assert.equal('grant_refs' in first, false);

// 2. history: one row per applied grant, newest first, customer-safe
const hist = await wallet.listWalletTransactions('c1');
assert.equal(hist.length, 4);
assert.equal(hist.filter((h) => h.payment_ref === 'pi_1').length, 1);
assert.deepEqual(Object.keys(hist[0]).sort(), ['amount_usd', 'balance_after_usd', 'created_at', 'id', 'paid_usd', 'payment_ref', 'plan_id', 'plan_name', 'reason', 'type']);

// 3. allowance change is recorded as a delta
await wallet.setWalletAllowance('c3', { free_allowance_usd: 10 });
await wallet.setWalletAllowance('c3', { free_allowance_usd: 4 });
const h3 = await wallet.listWalletTransactions('c3');
assert.deepEqual(h3.map((h) => [h.type, h.amount_usd]), [['allowance_set', -6], ['allowance_set', 10]]);

// 4. trial: first use provisions once, even under concurrency
const gates = await Promise.all(Array.from({ length: 20 }, () => wallet.assertNovaCredits('new-co')));
assert.ok(gates.every((g) => g.ok));
const trial = await wallet.getWallet('new-co');
assert.equal(trial.free_allowance_micros, 5_000_000);
assert.equal((await wallet.listWalletTransactions('new-co')).filter((h) => h.type === 'trial').length, 1);

// 5. low balance + exhausted flags come from the server
await wallet.incrementWalletSpent('new-co', 4.2); // $0.80 of $5 left -> under $2 floor
let api = wallet.walletToApi(await wallet.getWallet('new-co'));
assert.equal(api.low_balance, true);
assert.equal(api.exhausted, false);
await wallet.incrementWalletSpent('new-co', 1);
api = wallet.walletToApi(await wallet.getWallet('new-co'));
assert.equal(api.exhausted, true);
assert.equal(api.low_balance, false);
const blocked = await wallet.assertNovaCredits('new-co');
assert.equal(blocked.ok, false);
assert.equal(blocked.status, 402);

// 6. a turn may only spend what is left (billable remaining / (1 + markup) in provider dollars)
await wallet.setWalletAllowance('cap-co', { free_allowance_usd: 10 });
await wallet.incrementWalletSpent('cap-co', 5); // $5 left
const cap = await wallet.getTurnCreditCapUsd('cap-co');
assert.ok(Math.abs(cap - 4) < 1e-9, `expected 4.00 provider dollars, got ${cap}`);
assert.equal(await wallet.getTurnCreditCapUsd('no-wallet'), null);

console.log('wallet ledger integration: all checks passed');
await mongoose.disconnect();
await mongod.stop();
