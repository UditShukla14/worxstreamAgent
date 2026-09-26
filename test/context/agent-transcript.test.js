/**
 * P1: agent transcript + hot window from tool outputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  capToolResultContent,
  extractTurnAgentTranscript,
  compactTranscriptMessage,
} from '../../src/nova/agents/agentTranscript.js';
import {
  expandStoredMessagesForAgent,
  buildOrchestratorMessages,
  messageContentToString,
} from '../../src/utils/conversationHistory.js';

describe('agent transcript (P1)', () => {
  it('caps large tool results', () => {
    const big = 'x'.repeat(5000);
    const capped = capToolResultContent(big, 100);
    assert.ok(capped.length < 200);
    assert.ok(capped.includes('[truncated'));
  });

  it('extracts turn transcript without the turn prompt', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const live = [
      ...history,
      { role: 'user', content: 'Session context…\nUser request: find Acme' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'list_customers', input: { filter: { search: 'Acme' } } }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 't1',
          content: JSON.stringify({ data: [{ id: 2001, customer_id: 3001, name: 'Acme' }] }),
        }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Found Acme.' }],
      },
    ];
    const transcript = extractTurnAgentTranscript(live, history.length);
    assert.equal(transcript[0].role, 'assistant');
    assert.equal(transcript[0].content[0].name, 'list_customers');
    assert.equal(transcript[1].role, 'user');
    assert.equal(transcript[1].content[0].type, 'tool_result');
    assert.ok(transcript[1].content[0].content.includes('customer_id'));
    assert.equal(transcript[2].content[0].text, 'Found Acme.');
  });

  it('expands stored agent_transcript so follow-ups see tool JSON', () => {
    const stored = [
      { role: 'user', content: 'find Acme' },
      {
        role: 'assistant',
        content: '<table>UI only</table>',
        agent_transcript: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'list_customers', input: {} }],
          },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 't1',
              content: '{"data":[{"customer_id":30000000037,"name":"Acme"}]}',
            }],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Found Acme (customer_id 30000000037).' }],
          },
        ],
      },
    ];
    const expanded = expandStoredMessagesForAgent(stored);
    assert.equal(expanded[0].role, 'user');
    assert.equal(expanded[0].content, 'find Acme');
    assert.equal(expanded[1].role, 'assistant');
    assert.equal(expanded[1].content[0].type, 'tool_use');
    assert.equal(expanded[2].content[0].type, 'tool_result');
    assert.ok(expanded[2].content[0].content.includes('30000000037'));
    // UI XML must not be the agent memory when transcript exists
    assert.ok(!JSON.stringify(expanded).includes('<table>'));
  });

  it('falls back to UI + tool_activity when no agent_transcript', () => {
    const stored = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Hello',
        tool_activity: [{ tool: 'list_customers', input: '{}', ok: true }],
      },
    ];
    const expanded = expandStoredMessagesForAgent(stored);
    assert.equal(expanded.length, 2);
    assert.ok(String(expanded[1].content).includes('[Tools used this turn]'));
  });

  it('buildOrchestratorMessages packs transcript-aware history', () => {
    const prior = [
      { role: 'user', content: 'find Acme' },
      {
        role: 'assistant',
        content: 'UI',
        agent_transcript: [
          { role: 'assistant', content: [{ type: 'text', text: 'Found Acme id=3001' }] },
        ],
      },
    ];
    const msgs = buildOrchestratorMessages({
      priorMessages: prior,
      currentUserContent: 'show his invoices',
    });
    const flat = msgs.map((m) => messageContentToString(m.content)).join('\n');
    assert.ok(flat.includes('Found Acme id=3001'));
    assert.ok(flat.includes('show his invoices'));
  });

  it('compactTranscriptMessage drops empty content', () => {
    assert.equal(compactTranscriptMessage({ role: 'assistant', content: [] }), null);
    assert.ok(compactTranscriptMessage({ role: 'assistant', content: 'ok' }));
  });
});
