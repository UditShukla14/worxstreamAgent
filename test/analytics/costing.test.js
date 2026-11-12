import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { computeEventCost, usdToMicros, microsToUsd, clampMarkup } = await import('../../src/analytics/costing.js');

describe('computeEventCost', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 500_000, cache_creation_input_tokens: 200_000 };

  it('prices every usage component in integer micro-USD (sonnet 4.6: 3 / 15 / 3.75 / 0.30)', () => {
    const c = computeEventCost({ model: 'claude-sonnet-4-6', usage, markupRate: 0 });
    // 3.00 + 1.50 + 0.75 + 0.15 = 5.40 USD
    assert.equal(c.providerMicros, 5_400_000);
    assert.equal(c.billableMicros, 5_400_000);
    assert.equal(c.providerCostUsd, 5.4);
    assert.ok(Number.isInteger(c.providerMicros));
  });

  it('applies markup per event and stores the rate used', () => {
    const c = computeEventCost({ model: 'claude-sonnet-4-6', usage, markupRate: 0.2 });
    assert.equal(c.providerMicros, 5_400_000);
    assert.equal(c.billableMicros, 6_480_000);
    assert.equal(c.markupRate, 0.2);
    assert.equal(c.billableUsd, 6.48);
  });

  it('does not round to cents: tiny calls keep micro precision', () => {
    const c = computeEventCost({ model: 'claude-haiku-5-5', usage: { input_tokens: 1234, output_tokens: 56 }, markupRate: 0.2 });
    // 1234*0.1 + 56*0.5 = 151.4 -> 151 micros; billable round(151*1.2)=181
    assert.equal(c.providerMicros, 151);
    assert.equal(c.billableMicros, 181);
  });

  it('prices from the model the API served (response.model) and flags unknown models as estimated', () => {
    const served = computeEventCost({ model: 'claude-haiku-4-5', responseModel: 'claude-haiku-4-5-20251001', usage: { input_tokens: 1_000_000 }, markupRate: 0 });
    assert.equal(served.providerMicros, 1_000_000);
    assert.equal(served.estimated, false);
    const unknown = computeEventCost({ model: 'claude-mystery-9', usage: { input_tokens: 1_000_000 }, markupRate: 0 });
    assert.equal(unknown.estimated, true);
  });

  it('uses per-model cache read prices (Opus 5.5 reads at $0.20/M, not 0.1x)', () => {
    const c = computeEventCost({ model: 'claude-opus-5-5', usage: { cache_read_input_tokens: 1_000_000 }, markupRate: 0 });
    assert.equal(c.providerMicros, 200_000);
  });

  it('clamps markup and converts units both ways', () => {
    assert.equal(clampMarkup(-1), 0);
    assert.equal(clampMarkup(99), 5);
    assert.equal(clampMarkup('abc'), 0);
    assert.equal(usdToMicros(1.234567), 1_234_567);
    assert.equal(microsToUsd(1_234_567), 1.234567);
  });
});
