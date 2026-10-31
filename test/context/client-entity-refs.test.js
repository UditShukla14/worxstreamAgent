import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClientEntityRefs,
  formatReferencedRecordsBlock,
} from '../../src/nova/agents/ConversationContext.js';

describe('client entity refs (Nova # picks)', () => {
  it('normalizeClientEntityRefs keeps type, id, appId, label', () => {
    const refs = normalizeClientEntityRefs([
      { type: 'Customer', id: '30000000037', appId: 5, label: 'Customer Acme' },
      { type: 'invoice', objectId: 99, label: 'Invoice #1001', customNumber: '1001' },
      { type: '', id: 1 },
      null,
    ]);
    assert.equal(refs.length, 2);
    assert.deepEqual(refs[0], {
      type: 'customer',
      id: 30000000037,
      appId: 5,
      label: 'Customer Acme',
    });
    assert.equal(refs[1].type, 'invoice');
    assert.equal(refs[1].id, 99);
    assert.equal(refs[1].customNumber, '1001');
  });

  it('formatReferencedRecordsBlock tells the model not to resolve_entity', () => {
    const block = formatReferencedRecordsBlock([
      { type: 'customer', id: 30000000037, appId: 5, label: 'Acme' },
    ]);
    assert.match(block, /\[Referenced records\]/);
    assert.match(block, /customer "Acme" id=30000000037 appId=5/);
    assert.match(block, /Do NOT call resolve_entity/);
  });

  it('formatReferencedRecordsBlock is empty for no refs', () => {
    assert.equal(formatReferencedRecordsBlock([]), '');
    assert.equal(formatReferencedRecordsBlock(null), '');
  });
});
