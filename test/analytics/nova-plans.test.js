import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.ANTHROPIC_API_KEY ||= 'sk-test';

const { priceForCredit, toCustomerPlan, toAdminPlan } = await import('../../src/analytics/novaPlans.js');

describe('Nova plan pricing (Anthropic credit + margin)', () => {
  it('charges credit plus 20%', () => {
    assert.equal(priceForCredit(50, 0.2), 60);
    assert.equal(priceForCredit(250, 0.2), 300);
    assert.equal(priceForCredit(1000, 0.2), 1200);
  });

  it('rounds to the cent', () => {
    assert.equal(priceForCredit(33.33, 0.2), 40);
    assert.equal(priceForCredit(19.99, 0.2), 23.99);
  });

  it('supports other margins and none', () => {
    assert.equal(priceForCredit(100, 0), 100);
    assert.equal(priceForCredit(100, 0.35), 135);
  });

  it('rejects bad input', () => {
    assert.throws(() => priceForCredit(0, 0.2), /credit_usd/);
    assert.throws(() => priceForCredit(-5, 0.2), /credit_usd/);
    assert.throws(() => priceForCredit(50, -0.1), /margin_rate/);
    assert.throws(() => priceForCredit(50, 9), /margin_rate/);
  });
});

describe('plan views', () => {
  const doc = { plan_id: 'growth', name: 'Nova Growth', description: 'd', credit_usd: 250, margin_rate: 0.2, price_usd: 300, active: true, sort: 2 };

  it('never shows the margin to a company', () => {
    const view = toCustomerPlan(doc);
    assert.deepEqual(Object.keys(view).sort(), ['credit_usd', 'description', 'name', 'plan_id', 'price_usd']);
    assert.equal('margin_rate' in view, false);
  });

  it('shows staff the margin and state', () => {
    const view = toAdminPlan(doc);
    assert.equal(view.margin_rate, 0.2);
    assert.equal(view.active, true);
  });
});
