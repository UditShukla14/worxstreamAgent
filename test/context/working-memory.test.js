import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWorkingSetDelta,
  formatWorkingSetForPrompt,
  mergeWorkingSet,
} from '../../src/agents/workingMemory.js';

describe('working memory', () => {
  it('records failed create_* in lastOutcome', () => {
    const ctx = { entities: {}, entityRefs: {}, recentResults: [], workingSet: {} };
    const delta = deriveWorkingSetDelta(ctx, {
      message: 'create invoice for Acme',
      agentKey: 'invoice',
      toolsUsed: [{ name: 'create_invoice', success: false }],
      toolResults: [{ success: false, error: 'tax missing' }],
    });
    const ws = mergeWorkingSet({}, delta);
    assert.equal(ws.lastOutcome.success, false);
    assert.match(ws.lastOutcome.error, /tax/i);
    const prompt = formatWorkingSetForPrompt(ws);
    assert.match(prompt, /failed/i);
    assert.match(prompt, /Suggested next/i);
  });

  it('sets session goal on substantive message', () => {
    const delta = deriveWorkingSetDelta(
      { workingSet: {} },
      { message: 'Help me with month-end AR review for open invoices' },
    );
    assert.ok(delta.sessionGoal);
    assert.match(delta.sessionGoal, /AR|review/i);
  });

  it('accumulates per-tool failure notes and clears them on success', () => {
    const ctx = { entities: {}, entityRefs: {}, recentResults: [], workingSet: {} };

    // Turn 1: create_task fails with a validation error, lookup succeeds.
    const delta1 = deriveWorkingSetDelta(ctx, {
      message: 'create task for Santiago',
      agentKey: 'task',
      toolsUsed: [
        { name: 'list_team_members', success: true },
        { name: 'create_task', success: false, error: 'The issue type field is required.' },
      ],
      toolResults: [{ success: true }, { success: false, error: 'The issue type field is required.' }],
    });
    let ws = mergeWorkingSet({}, delta1);
    assert.match(ws.toolNotes.create_task.error, /issue type/i);
    assert.equal(ws.toolNotes.list_team_members, undefined);

    const prompt = formatWorkingSetForPrompt(ws);
    assert.match(prompt, /Known tool errors/i);
    assert.match(prompt, /create_task: The issue type field is required/i);

    // Turn 2: create_task succeeds — note is cleared.
    const delta2 = deriveWorkingSetDelta({ ...ctx, workingSet: ws }, {
      message: 'retry',
      agentKey: 'task',
      toolsUsed: [{ name: 'create_task', success: true }],
      toolResults: [{ success: true }],
    });
    ws = mergeWorkingSet(ws, delta2);
    assert.equal(ws.toolNotes, undefined);
  });

  it('caps tool notes at 5 most recent', () => {
    let ws = {};
    for (let i = 0; i < 8; i++) {
      const delta = deriveWorkingSetDelta({ workingSet: ws }, {
        message: 'x',
        toolsUsed: [{ name: `tool_${i}`, success: false, error: `err ${i}` }],
        toolResults: [{ success: false, error: `err ${i}` }],
      });
      ws = mergeWorkingSet(ws, delta);
    }
    assert.ok(Object.keys(ws.toolNotes).length <= 5);
  });
});
