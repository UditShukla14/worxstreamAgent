import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.ANTHROPIC_API_KEY ||= 'sk-test';

const { DEFAULT_PRICING, sanitizePricing, marginForAmount, quoteForPrice, toCustomerQuote, bonusTiers } = await import('../../src/analytics/novaPricing.js');
const { toCustomerPlan, toAdminPlan } = await import('../../src/analytics/novaPlans.js');
const { optionsFor, MODEL_TASKS } = await import('../../src/analytics/customerModels.js');
const { DEFAULT_TASK_MODELS } = await import('../../src/analytics/taskModels.js');

const settings = { ...DEFAULT_PRICING, tiers: DEFAULT_PRICING.tiers.map((t) => ({ ...t })) };
const K = 0.2; // the debit markup (Worxstream's base margin)

describe('volume-discount margin', () => {
  it('uses the margin of the last tier the amount reaches', () => {
    assert.equal(marginForAmount(20, settings.tiers), 0.2);
    assert.equal(marginForAmount(249.99, settings.tiers), 0.2);
    assert.equal(marginForAmount(250, settings.tiers), 0.18);
    assert.equal(marginForAmount(999, settings.tiers), 0.18);
    assert.equal(marginForAmount(1000, settings.tiers), 0.15);
    assert.equal(marginForAmount(50000, settings.tiers), 0.15);
  });
});

describe('quote: what an amount costs and buys', () => {
  it('small amounts get exactly what they pay (20% margin = the base markup)', () => {
    const q = quoteForPrice(50, settings, K);
    assert.equal(q.credit_usd, 50);
    assert.equal(q.bonus_pct, 0);
    assert.equal(q.margin_rate, 0.2);
  });

  it('larger amounts get bonus credit instead of a lower price', () => {
    const q250 = quoteForPrice(250, settings, K);
    assert.equal(q250.price_usd, 250);
    assert.equal(q250.credit_usd, 254.24); // 250 x 1.2 / 1.18
    assert.equal(q250.bonus_pct, 1.7);
    const q1000 = quoteForPrice(1000, settings, K);
    assert.equal(q1000.credit_usd, 1043.48); // 1000 x 1.2 / 1.15
    assert.equal(q1000.bonus_pct, 4.3);
  });

  it('keeps Worxstream the intended margin on Anthropic cost', () => {
    const q = quoteForPrice(1000, settings, K);
    // the credit covers credit/1.2 of Anthropic usage; the margin over that cost is price/value - 1 = 15%
    assert.ok(Math.abs(q.price_usd / q.anthropic_value_usd - 1.15) < 0.001);
    assert.equal(q.margin_usd, Math.round((1000 - q.anthropic_value_usd) * 100) / 100);
  });

  it('never gives a margin above the debit markup (no negative bonus)', () => {
    const q = quoteForPrice(1000, { ...settings, tiers: [{ min_usd: 0, margin_rate: 0.3 }] }, K);
    assert.equal(q.margin_rate, 0.2);
    assert.equal(q.credit_usd, 1000);
  });

  it('estimates the number of requests from the typical request cost', () => {
    assert.equal(quoteForPrice(50, settings, K).estimated_requests, 330); // 50 / 0.15 = 333 -> 330
    assert.equal(quoteForPrice(1000, settings, K).estimated_requests, 6960); // 1043.48 / 0.15 = 6956.5 -> 6960
  });

  it('rejects bad amounts', () => {
    assert.throws(() => quoteForPrice(0, settings, K), /amount/);
    assert.throws(() => quoteForPrice(-5, settings, K), /amount/);
  });

  it('shows a company only what it pays and receives', () => {
    const view = toCustomerQuote(quoteForPrice(250, settings, K));
    assert.deepEqual(Object.keys(view).sort(), ['bonus_pct', 'credit_usd', 'estimated_requests', 'price_usd']);
  });

  it('lists where bigger bonuses start', () => {
    assert.deepEqual(bonusTiers(settings, K), [{ min_usd: 250, bonus_pct: 1.7 }, { min_usd: 1000, bonus_pct: 4.3 }]);
  });
});

describe('pricing settings validation', () => {
  it('accepts the defaults', () => {
    assert.deepEqual(sanitizePricing({}), DEFAULT_PRICING);
  });

  it('requires the first tier to start at 0', () => {
    assert.throws(() => sanitizePricing({ tiers: [{ min_usd: 10, margin_rate: 0.2 }] }), /start at 0/);
  });

  it('does not let a bigger purchase have a higher margin', () => {
    assert.throws(() => sanitizePricing({ tiers: [{ min_usd: 0, margin_rate: 0.15 }, { min_usd: 500, margin_rate: 0.2 }] }), /higher margin/);
  });

  it('checks the custom range and the typical request cost', () => {
    assert.throws(() => sanitizePricing({ custom_min_usd: 100, custom_max_usd: 50 }), /custom_max_usd/);
    assert.throws(() => sanitizePricing({ typical_request_usd: 0 }), /typical_request_usd/);
  });
});

describe('plan views', () => {
  const doc = { plan_id: 'growth', name: 'Nova Growth', description: 'd', features: ['A', 'B'], price_usd: 250, active: true, sort: 2 };
  const ctx = { settings, markup: K };

  it('shows a company the price, credit, bonus, estimate and features, never the margin', () => {
    const view = toCustomerPlan(doc, ctx);
    assert.deepEqual(Object.keys(view).sort(), ['bonus_pct', 'credit_usd', 'description', 'estimated_requests', 'features', 'name', 'plan_id', 'price_usd']);
    const text = JSON.stringify(view).toLowerCase();
    assert.equal(text.includes('margin') || text.includes('anthropic'), false);
  });

  it('shows staff the margin and what the credit covers', () => {
    const view = toAdminPlan(doc, ctx);
    assert.equal(view.margin_rate, 0.18);
    assert.equal(view.anthropic_value_usd, 211.87);
    assert.equal(view.margin_usd, 38.13);
  });
});

describe('company model options', () => {
  it('marks the recommended model once per task', () => {
    for (const task of MODEL_TASKS) {
      const options = optionsFor(task.key, [], K);
      const rec = options.filter((o) => o.recommended);
      assert.equal(rec.length, 1, `exactly one recommendation for ${task.key}`);
      assert.equal(rec[0].id, DEFAULT_TASK_MODELS[task.key]);
    }
  });

  it('puts the recommended model on one of the four cards, not in an extra "Other" card', () => {
    for (const task of MODEL_TASKS) {
      const options = optionsFor(task.key, [], K);
      assert.equal(options.length, 4);
      assert.deepEqual(options.map((o) => o.label), ['Fast', 'Balanced', 'Advanced', 'Most capable']);
      assert.equal(options.find((o) => o.recommended).label, task.key === 'daily' ? 'Fast' : 'Balanced');
    }
  });

  it('charges 20% above the provider price at a 20% markup', () => {
    const options = optionsFor('medium', [], 0.2);
    const opus = options.find((o) => o.id === 'claude-opus-5-5'); // provider $4 in / $20 out
    assert.equal(opus.charged_input_per_million, 4.8);
    assert.equal(opus.charged_output_per_million, 24);
  });

  it('keeps an extra chosen model in the list and never exposes provider fields', () => {
    const options = optionsFor('daily', ['claude-opus-4-6'], K);
    assert.ok(options.some((o) => o.id === 'claude-opus-4-6'));
    assert.equal(JSON.stringify(options).includes('inputPerMillion'), false);
  });
});
