import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogForEvent,
  clearCatalogContext,
  invalidateCatalogContext,
  peekCatalogContext,
  primeCatalogContext,
} from '../../src/control/catalogContext.js';
import { loadPolicyCatalog } from '../../src/control/contextBuilder.js';

const snapshot = {
  policies: [
    { id: 'p1', name: 'Credit Hold Policy', content: 'Hold at 3 overdue.', status: 'active' },
    { id: 'p2', name: 'Minimum Margin Policy', content: 'Margin 20%.', status: 'active' },
  ],
  rules: [
    {
      id: 'r1',
      name: 'Flag Low Margin Estimates',
      eventTypes: ['estimate.created', 'estimate.updated'],
      condition: 'grossProfitPercentage < 20',
      action: 'Flag',
    },
    {
      id: 'r2',
      name: 'Credit Warning',
      eventType: 'invoice.created',
      eventTypes: ['invoice.created'],
      condition: '2 overdue',
      action: 'Warn',
    },
  ],
  loadedAt: '2026-08-20T10:00:00.000Z',
  version: 'test-1',
};

describe('persistent catalog context', () => {
  beforeEach(() => {
    clearCatalogContext();
  });

  it('filters active rules to the event type without dropping policies', () => {
    const forEstimate = catalogForEvent(snapshot, 'estimate.created');
    assert.equal(forEstimate.policies.length, 2);
    assert.equal(forEstimate.rules.length, 1);
    assert.equal(forEstimate.rules[0].name, 'Flag Low Margin Estimates');

    const forInvoice = catalogForEvent(snapshot, 'invoice.created');
    assert.equal(forInvoice.rules.length, 1);
    assert.equal(forInvoice.rules[0].name, 'Credit Warning');
  });

  it('reuses a primed snapshot until it is invalidated', async () => {
    const companyId = '__catalog_test__';
    primeCatalogContext(companyId, snapshot);
    const first = await loadPolicyCatalog(companyId, 'estimate.created');
    const second = await loadPolicyCatalog(companyId, 'estimate.updated');
    assert.equal(peekCatalogContext(companyId).version, 'test-1');
    assert.equal(first.policies.length, 2);
    assert.equal(second.rules.length, 1);
    assert.equal(first.loadedAt, snapshot.loadedAt);

    await invalidateCatalogContext(companyId);
    assert.equal(peekCatalogContext(companyId), null);
  });
});
