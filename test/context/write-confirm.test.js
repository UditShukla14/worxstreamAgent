import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isWriteTool, shouldConfirmWrites } from '../../src/agents/pendingConfirm.js';

describe('write confirmation', () => {
  it('identifies write tools by name', () => {
    assert.equal(isWriteTool('create_invoice'), true);
    assert.equal(isWriteTool('list_invoices'), false);
    assert.equal(isWriteTool('update_customer'), true);
  });

  it('shouldConfirmWrites respects config flag', () => {
    const prev = process.env.COWORKER_CONFIRM_WRITES;
    process.env.COWORKER_CONFIRM_WRITES = 'false';
    assert.equal(shouldConfirmWrites({}), false);
    process.env.COWORKER_CONFIRM_WRITES = prev;
  });
});
