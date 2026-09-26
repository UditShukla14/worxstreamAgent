/**
 * P2 summary hints, P3 continue helpers, P4 scrape-off defaults.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatSessionHintsForSummary } from '../../src/utils/conversationSummary.js';
import { config } from '../../src/config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('P2–P4 remaining changes.md items', () => {
  it('P2: session hints include goal, task, entities', () => {
    const block = formatSessionHintsForSummary({
      workingSet: {
        sessionGoal: 'Month-end invoices',
        taskState: { goal: 'Email Acme overdue', status: 'in_progress', next: ['list_invoices'] },
      },
      entities: { customer_id: 3001, sms_draft_id: 'x' },
      entityRefs: { customer: { id: 3001, label: 'Acme' } },
      toolsUsed: [{ name: 'list_invoices' }],
    });
    assert.ok(block.includes('Goal: Month-end invoices'));
    assert.ok(block.includes('Open task: Email Acme overdue'));
    assert.ok(block.includes('customer_id=3001'));
    assert.ok(block.includes('Acme'));
    assert.ok(block.includes('list_invoices'));
  });

  it('P4: entity ID scrape is off by default', () => {
    assert.equal(config.coworker.scrapeEntityIds, false);
  });

  it('P3: BaseAgent has continue slices; pipeline resumes continue messages', () => {
    const agentSrc = readFileSync(join(__dirname, '../../src/nova/agents/BaseAgent.js'), 'utf8');
    assert.ok(agentSrc.includes('maxContinueSlices'));
    assert.ok(agentSrc.includes('needsContinue'));
    assert.ok(agentSrc.includes('task_progress'));
    assert.ok(agentSrc.includes('max_tokens'));

    const pipeSrc = readFileSync(join(__dirname, '../../src/nova/agents/coworkerPipeline.js'), 'utf8');
    assert.ok(pipeSrc.includes('isContinueMessage'));
    assert.ok(pipeSrc.includes('waiting_continue'));
    assert.ok(pipeSrc.includes('resumingContinue'));
    assert.ok(pipeSrc.includes('sessionHints'));
  });

  it('P4: ConversationContext gates ID scrape behind scrapeEntityIds', () => {
    const src = readFileSync(join(__dirname, '../../src/nova/agents/ConversationContext.js'), 'utf8');
    assert.ok(src.includes('scrapeEntityIds'));
    assert.ok(src.includes('Prefer tool results in conversation history'));
  });

  it('P3 config exposes AGENT_CONTINUE_SLICES', () => {
    assert.ok(Number.isFinite(config.coworker.maxContinueSlices));
    assert.ok(config.coworker.maxContinueSlices >= 1);
  });
});
