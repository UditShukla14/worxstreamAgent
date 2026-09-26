/**
 * ConversationTurn store — professional turn-by-turn transcript + logs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { turnsToPriorMessages, turnToApi } from '../../src/nova/agents/conversationTurns.js';
import { expandStoredMessagesForAgent } from '../../src/utils/conversationHistory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('conversation turns', () => {
  it('turnsToPriorMessages feeds agent transcript into history expand', () => {
    const turns = [{
      turn_index: 0,
      user: { content: 'find Acme' },
      ui: { content: '<table>Acme</table>' },
      transcript: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: '1', name: 'list_customers', input: {} }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: '1',
            content: '{"data":[{"customer_id":3001,"name":"Acme"}]}',
          }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Found Acme' }] },
      ],
      log: { tools: [{ tool: 'list_customers', input: '{}', ok: true }] },
    }];

    const prior = turnsToPriorMessages(turns);
    assert.equal(prior[0].role, 'user');
    assert.equal(prior[1].role, 'assistant');
    assert.ok(prior[1].agent_transcript?.length > 0);
    assert.ok(!JSON.stringify(prior[1].content).includes('tool_use'));

    const expanded = expandStoredMessagesForAgent(prior);
    assert.ok(JSON.stringify(expanded).includes('list_customers'));
    assert.ok(JSON.stringify(expanded).includes('3001'));
    assert.ok(!JSON.stringify(expanded).includes('<table>'));
  });

  it('turnToApi omits transcript unless requested', () => {
    const turn = {
      turn_id: 'a',
      turn_index: 0,
      user: { content: 'hi' },
      ui: { content: 'hello' },
      transcript: [{ role: 'assistant', content: 'x' }],
      log: { status: 'completed' },
    };
    assert.equal(turnToApi(turn).transcript, undefined);
    assert.ok(turnToApi(turn, { includeTranscript: true }).transcript);
  });

  it('pipeline persists ConversationTurn and loads from turns', () => {
    const src = readFileSync(join(__dirname, '../../src/nova/agents/coworkerPipeline.js'), 'utf8');
    assert.ok(src.includes('appendConversationTurn'));
    assert.ok(src.includes('listConversationTurns'));
    assert.ok(src.includes('turnsToPriorMessages'));
    assert.ok(src.includes('deleteConversationTurns'));
  });

  it('turns API route is registered', () => {
    const src = readFileSync(join(__dirname, '../../src/nova/routes/agents.js'), 'utf8');
    assert.ok(src.includes("/conversations/:conversation_id/turns"));
  });
});
