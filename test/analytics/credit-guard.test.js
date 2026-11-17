import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY ||= 'sk-test';
process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { fitCallToBudget, priceBoundsFor, CreditExhaustedError, MIN_OUTPUT_TOKENS } = await import('../../src/analytics/creditGuard.js');

const call = (over = {}) => ({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Summarise my unread mail.' }],
  ...over,
});
const budget = (providerBudgetUsd, spentProviderUsd = 0) => ({ companyId: 'c1', holdId: 'h', providerBudgetUsd, spentProviderUsd, pending: [] });

/** The most a call could cost (Anthropic's price) if it reads its input and writes max_tokens. */
function worstCaseUsd(params) {
  const { inputCostUsd, outputPerTokenUsd } = priceBoundsFor(params);
  return inputCostUsd + params.max_tokens * outputPerTokenUsd;
}

describe('fitCallToBudget', () => {
  it('leaves a call alone when its worst case fits', () => {
    const p = call();
    assert.equal(fitCallToBudget(budget(5), p), p);
  });

  it('shrinks max_tokens so the worst case fits what is left, and never raises it', () => {
    const p = call({ max_tokens: 8000 });
    const left = 0.02; // $0.02 of provider budget
    const fitted = fitCallToBudget(budget(left), p);
    assert.ok(fitted.max_tokens < 8000 && fitted.max_tokens >= MIN_OUTPUT_TOKENS);
    assert.ok(worstCaseUsd(fitted) <= left, `worst case ${worstCaseUsd(fitted)} must stay within ${left}`);
    // and it is the LARGEST such value: one more token would not fit
    assert.ok(worstCaseUsd({ ...fitted, max_tokens: fitted.max_tokens + 1 }) > left);
  });

  it('counts what the turn already spent', () => {
    const p = call({ max_tokens: 8000 });
    const fresh = fitCallToBudget(budget(0.05), p).max_tokens;
    const afterSpending = fitCallToBudget(budget(0.05, 0.03), p).max_tokens;
    assert.ok(afterSpending < fresh);
  });

  it('refuses a call when not even a short answer fits', () => {
    assert.throws(() => fitCallToBudget(budget(0.0001), call()), (e) => e instanceof CreditExhaustedError && e.code === 'NOVA_CREDIT_EXHAUSTED' && e.status === 402);
    assert.throws(() => fitCallToBudget(budget(0.05, 0.05), call()), CreditExhaustedError); // nothing left
  });

  it('refuses a call whose INPUT alone is dearer than what is left', () => {
    const big = call({ messages: [{ role: 'user', content: 'x'.repeat(400_000) }] }); // ~100k tokens of input
    assert.throws(() => fitCallToBudget(budget(0.05), big), CreditExhaustedError);
  });

  it('drops a fixed thinking budget that no longer fits under the shortened answer limit', () => {
    const p = call({ max_tokens: 16000, thinking: { type: 'enabled', budget_tokens: 8000 } });
    const fitted = fitCallToBudget(budget(0.02), p);
    assert.equal(fitted.thinking, undefined);
    assert.ok(fitted.max_tokens < 8000);
    // when the answer limit stays above the thinking budget, thinking is kept
    const roomy = fitCallToBudget(budget(5), p);
    assert.deepEqual(roomy.thinking, { type: 'enabled', budget_tokens: 8000 });
  });

  it('prices the dearest model higher, so the same budget allows fewer tokens on it', () => {
    const cheap = fitCallToBudget(budget(0.05), call({ model: 'claude-haiku-4-5', max_tokens: 64000 })).max_tokens;
    const dear = fitCallToBudget(budget(0.05), call({ model: 'claude-opus-4-6', max_tokens: 64000 })).max_tokens;
    assert.ok(dear < cheap);
  });
});
