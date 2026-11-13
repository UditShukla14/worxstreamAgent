import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.ANTHROPIC_API_KEY ||= 'sk-test';

const { isLowBalance, walletToApi } = await import('../../src/analytics/novaWallet.js');

describe('low balance rule', () => {
  it('is low under the dollar floor even on a big grant', () => {
    assert.equal(isLowBalance({ enforced: true, remaining: 1.5, granted: 1000 }), true);
  });

  it('is low under 10% of what was granted', () => {
    assert.equal(isLowBalance({ enforced: true, remaining: 20, granted: 250 }), true);
  });

  it('is not low when plenty is left', () => {
    assert.equal(isLowBalance({ enforced: true, remaining: 100, granted: 250 }), false);
  });

  it('is never low when empty (that is exhausted), unlimited, or without a wallet', () => {
    assert.equal(isLowBalance({ enforced: true, remaining: 0, granted: 50 }), false);
    assert.equal(isLowBalance({ enforced: false, remaining: 1, granted: 50 }), false);
    assert.equal(isLowBalance({ enforced: true, remaining: null, granted: 0 }), false);
  });
});

describe('customer wallet view', () => {
  const doc = (spentMicros) => ({
    company_id: 'c1',
    limits_enabled: true,
    free_allowance_micros: 0,
    purchased_credit_micros: 50_000_000,
    spent_micros: spentMicros,
    markup_rate: 0.3,
    grant_refs: ['pi_1'],
  });

  it('reports low and exhausted from the server rule', () => {
    assert.equal(walletToApi(doc(49_000_000)).low_balance, true);
    assert.equal(walletToApi(doc(49_000_000)).exhausted, false);
    assert.equal(walletToApi(doc(50_000_000)).exhausted, true);
    assert.equal(walletToApi(doc(50_000_000)).low_balance, false);
    assert.equal(walletToApi(doc(10_000_000)).low_balance, false);
  });

  it('never exposes the markup or payment references', () => {
    const view = walletToApi(doc(0));
    assert.equal('markup_rate' in view, false);
    assert.equal('grant_refs' in view, false);
    assert.equal('notes' in view, false);
  });

  it('has no flags for a company without a wallet', () => {
    const view = walletToApi(null);
    assert.equal(view.low_balance, false);
    assert.equal(view.exhausted, false);
    assert.equal(view.exists, false);
  });
});
