import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { toCustomerUsage } = await import('../../src/analytics/customerUsage.js');

describe('customer usage view', () => {
  const usage = {
    company_id: 'c1',
    totals: { cost_usd: 8, billable_usd: 10, total_tokens: 100, call_count: 3 },
    users: [{ user_id: '7', cost_usd: 4, billable_usd: 5, total_tokens: 50, call_count: 1 }],
    models: [{ model: 'm', cost_usd: 8, billable_usd: 10, total_tokens: 100, call_count: 3 }],
    daily: [{ date: '2026-11-01', cost_usd: 8, billable_usd: 10, total_tokens: 100, call_count: 3 }],
  };

  it('shows what the company is charged under cost_usd and hides the provider cost', () => {
    const view = toCustomerUsage(usage);
    assert.equal(view.totals.cost_usd, 10);
    assert.equal(view.users[0].cost_usd, 5);
    assert.equal(view.models[0].cost_usd, 10);
    assert.equal(view.daily[0].cost_usd, 10);
    assert.equal(JSON.stringify(view).includes('billable_usd'), false);
    assert.equal(JSON.stringify(view).includes('"cost_usd":8'), false);
  });

  it('falls back to cost_usd for rows recorded before billable amounts existed', () => {
    const view = toCustomerUsage({ totals: { cost_usd: 3 }, daily: [{ date: 'd', cost_usd: 3 }] });
    assert.equal(view.totals.cost_usd, 3);
    assert.equal(view.daily[0].cost_usd, 3);
  });

  it('leaves non-objects alone', () => {
    assert.equal(toCustomerUsage(null), null);
  });
});
