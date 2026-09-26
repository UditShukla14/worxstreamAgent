/**
 * Execution plan helpers (orchestrator plan-before-tools).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  formatExecutionPlanForPrompt,
  isDirectChatMessage,
  normalizeExecutionPlan,
  planToTaskState,
} from '../../src/nova/agents/executionPlan.js';
import { mergeWorkingSet, formatWorkingSetForPrompt } from '../../src/nova/agents/workingMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('execution plan helpers', () => {
  it('treats greetings as direct chat', () => {
    assert.equal(isDirectChatMessage('hi'), true);
    assert.equal(isDirectChatMessage('Thanks!'), true);
    assert.equal(isDirectChatMessage('show invoices for Acme'), false);
  });

  it('normalizes plan JSON and formats prompt block', () => {
    const plan = normalizeExecutionPlan({
      mode: 'EXECUTE',
      goal: 'List Acme invoices',
      steps: ['Resolve Acme', 'list_invoices page 1', '', null],
      ask: null,
      risk: 'read',
    });
    assert.equal(plan.mode, 'execute');
    assert.equal(plan.steps.length, 2);
    const block = formatExecutionPlanForPrompt(plan);
    assert.ok(block.includes('[Execution plan]'));
    assert.ok(block.includes('Resolve Acme'));
    const ts = planToTaskState(plan);
    assert.equal(ts.status, 'in_progress');
    assert.deepEqual(ts.next, plan.steps);
  });

  it('mergeWorkingSet stores executionPlan and taskState', () => {
    const ws = mergeWorkingSet({}, {
      executionPlan: { mode: 'execute', goal: 'G' },
      taskState: { status: 'in_progress', goal: 'G', next: ['a'] },
    });
    assert.equal(ws.executionPlan.goal, 'G');
    assert.equal(ws.taskState.status, 'in_progress');
    const prompt = formatWorkingSetForPrompt(ws);
    assert.ok(prompt.includes('Task: G'));
  });

  it('pipeline wires execution plan for orchestrator', () => {
    const src = readFileSync(join(__dirname, '../../src/nova/agents/coworkerPipeline.js'), 'utf8');
    assert.ok(src.includes('getExecutionPlan'));
    assert.ok(src.includes("type: 'plan'"));
    assert.ok(src.includes('plan_clarify'));
    assert.ok(src.includes('STATUS_LABEL_PLANNING'));
  });
});
