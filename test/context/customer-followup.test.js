import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectClarificationNeeded,
  resolveClarificationPick,
} from '../../src/agents/workingMemory.js';

describe('customer follow-up / clarification', () => {
  const ctx = {
    entities: {},
    recentResults: [{
      entityType: 'customer',
      items: [
        { id: 30000000001, label: 'Acme East' },
        { id: 30000000002, label: 'Acme West' },
      ],
    }],
    workingSet: {},
  };

  it('detects ambiguous pronoun when multiple list rows exist', () => {
    const c = detectClarificationNeeded(ctx, 'show invoices for the second one');
    assert.ok(c);
    assert.equal(c.options.length, 2);
  });

  it('resolveClarificationPick sets customer_id from #2', () => {
    const withPending = {
      ...ctx,
      workingSet: {
        pendingClarification: {
          kind: 'pick_customer',
          options: [
            { index: 1, id: 30000000001, label: 'Acme East' },
            { index: 2, id: 30000000002, label: 'Acme West' },
          ],
        },
      },
    };
    const patch = resolveClarificationPick(withPending, 'use #2');
    assert.equal(patch.entities.customer_id, 30000000002);
    assert.equal(patch.workingSet.pendingClarification, null);
  });
});
