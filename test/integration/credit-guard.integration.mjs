// Real-MongoDB check of the credit guard (in-memory Mongo, fake Anthropic that always writes the LONGEST answer allowed).
//   npm i --no-save mongodb-memory-server && node test/integration/credit-guard.integration.mjs
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
process.env.NOVA_MAX_TURN_COST_USD = '3';

const mongoose = (await import(pathToFileURL(`${ROOT}/node_modules/mongoose/index.js`).href)).default;
await mongoose.connect(process.env.MONGODB_URL);

const wallet = await imp('src/analytics/novaWallet.js');
const guard = await imp('src/analytics/creditGuard.js');
const { createMessage, __setAnthropicClientForTests } = await imp('src/llm/anthropicClient.js');
const { enterRequestContext } = await imp('src/request/requestContext.js');
const W = (await imp('src/analytics/models/CompanyNovaWallet.js')).default;
const E = (await imp('src/analytics/models/LlmUsageEvent.js')).default;
await W.init(); await E.init();

const remainingOf = async (id) => wallet.walletToApi(await wallet.getWallet(id)).remaining_usd;
const grant = (id, usd) => wallet.grantWalletCredits(id, { amount_usd: usd, payment_ref: `pi_${id}`, reason: 'test' });

// ---------- holds: concurrent turns can never hold more than the company has ----------
await grant('c1', 1.0);
const tries = await Promise.all(Array.from({ length: 6 }, (_, i) => wallet.reserveCredit('c1', { holdId: `h${i}`, desiredMicros: 400_000, minMicros: 10_000 })));
const granted = tries.filter(Boolean).reduce((s, t) => s + t.grantedMicros, 0);
assert.ok(granted <= 1_000_000, `held ${granted} of 1,000,000`);
assert.equal(tries.filter(Boolean).length, 3); // 0.4 + 0.4 + 0.2 (partial), the rest wait
assert.deepEqual(tries.filter(Boolean).map((t) => t.grantedMicros).sort(), [200_000, 400_000, 400_000]);
// the last, partial hold is below the minimum for anyone else: refused
assert.equal(await wallet.reserveCredit('c1', { holdId: 'late', desiredMicros: 400_000, minMicros: 10_000 }), null);
// releasing a hold frees it
const firstHeld = tries.findIndex(Boolean);
await wallet.releaseCredit('c1', `h${firstHeld}`);
assert.ok(await wallet.reserveCredit('c1', { holdId: 'again', desiredMicros: 300_000, minMicros: 10_000 }));
// a turn that died is forgotten once its hold expires
const expired = await wallet.reserveCredit('c2', { holdId: 'x', desiredMicros: 1, minMicros: 1 }); // no wallet: nothing to hold
assert.equal(expired, null);
await grant('c3', 0.5);
await wallet.reserveCredit('c3', { holdId: 'dead', desiredMicros: 500_000, minMicros: 1, ttlMs: 20 });
assert.equal(await wallet.reserveCredit('c3', { holdId: 'blocked', desiredMicros: 100_000, minMicros: 1 }), null);
await new Promise((r) => setTimeout(r, 40));
assert.ok(await wallet.reserveCredit('c3', { holdId: 'free-again', desiredMicros: 100_000, minMicros: 1 }));

// ---------- a whole turn: the worst case never goes past the credit ----------
// The fake model always writes as many tokens as it is allowed to (the most expensive case).
let calls = 0;
__setAnthropicClientForTests({
  messages: {
    create: async (p) => {
      calls += 1;
      // the real input is about 1.6x the guard's raw estimate (a tokenizer can be worse than 4 characters per token): it must still hold
      return { id: `msg_${calls}`, model: p.model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 190, output_tokens: p.max_tokens } };
    },
  },
});

async function runTurn(companyId, rounds) {
  let budget;
  try {
    budget = await guard.beginCreditTurn(companyId);
  } catch (e) {
    if (e instanceof guard.CreditExhaustedError) return { done: 0, refused: true, notStarted: e.reason }; // 'busy' (held by another running turn) or 'exhausted'
    throw e;
  }
  let done = 0;
  let refused = false;
  await new Promise((resolve) => enterRequestContext({ companyId, userId: 'u1' }, async () => {
    await guard.runWithCreditBudget(budget, async () => {
      for (let i = 0; i < rounds; i++) {
        try {
          await createMessage({ model: 'claude-sonnet-4-6', max_tokens: 8000, system: 's', messages: [{ role: 'user', content: 'hello' }] }, { companyId, userId: 'u1', phase: 'agent' });
          done += 1;
        } catch (e) {
          if (e instanceof guard.CreditExhaustedError) { refused = true; break; }
          throw e;
        }
      }
    });
    resolve();
  }));
  return { done, refused };
}

// $1.00 of credit (the demo company): keep asking until refused
await grant('demo', 1.0);
let r = await runTurn('demo', 50);
assert.equal(r.refused, true);
let left = await remainingOf('demo');
assert.ok(left >= 0, `the company ended at ${left}, never below zero`);
assert.ok(left < 0.1, `it used almost all of the credit (left ${left}) rather than stopping early`);

// the same, many times over, with different amounts and several turns at once: nobody ends below zero
for (const [id, usd] of [['a', 0.05], ['b', 0.37], ['c', 2.5], ['d', 9.99]]) {
  await grant(id, usd);
  const results = await Promise.all([runTurn(id, 100), runTurn(id, 100), runTurn(id, 100)]);
  assert.ok(results.some((x) => !x.notStarted), `${id}: at least one turn ran`);
  const rem = await remainingOf(id);
  assert.ok(rem >= -1e-9, `${id}: ended at ${rem}`);
}
// every hold was given back
for (const id of ['demo', 'a', 'b', 'c', 'd']) assert.equal(((await W.findOne({ company_id: id }).select('+holds').lean()).holds || []).length, 0, `${id} still holds credit`);

// a company with no limit is untouched, and one that is empty is refused up front
assert.equal(await guard.beginCreditTurn('no-wallet'), null);
await grant('tiny', 0.015); // below the floor: no useful answer fits
await assert.rejects(() => guard.beginCreditTurn('tiny'), (e) => e.reason === 'exhausted' && e.status === 402);
assert.equal(wallet.walletToApi(await wallet.getWallet('tiny')).exhausted, true);

console.log('credit-guard integration: ok');
await mongoose.disconnect();
await mongod.stop();
