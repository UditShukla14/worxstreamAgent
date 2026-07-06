import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecialistHistory } from '../../src/utils/conversationHistory.js';
import { formatSummaryForPrompt } from '../../src/utils/conversationSummary.js';

describe('conversation history round-trip', () => {
  it('specialist history includes formatted assistant XML from prior turn', () => {
    const prior = [
      { role: 'user', content: 'list customers named Acme' },
      {
        role: 'assistant',
        content: '<table><row><cell>Acme Corp</cell></row></table>',
      },
      { role: 'user', content: 'show the second one' },
    ];
    const history = buildSpecialistHistory(prior);
    assert.ok(history.length >= 2);
    const assistant = history.find((m) => m.role === 'assistant');
    assert.ok(assistant);
    assert.match(assistant.content, /<table>/);
  });

  it('uses larger window when active task in progress', () => {
    const prior = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));
    const short = buildSpecialistHistory(prior, { workingSet: {} });
    const long = buildSpecialistHistory(prior, {
      workingSet: { activeTask: { status: 'in_progress', label: 'draft' } },
    });
    assert.ok(long.length >= short.length);
  });

  it('formats summary block for prompts', () => {
    const block = formatSummaryForPrompt('User is reviewing AR for customer 30000000037.');
    assert.match(block, /\[Conversation summary\]/);
    assert.match(block, /30000000037/);
  });

  it('replays stored tool activity into specialist history', () => {
    const prior = [
      { role: 'user', content: 'create a task for Santiago' },
      {
        role: 'assistant',
        content: 'I could not create the task yet.',
        tool_activity: [
          { tool: 'list_team_members', input: '{}', ok: true },
          {
            tool: 'create_task',
            input: '{"title":"Test","assign_to":10000000048}',
            ok: false,
            error: 'The issue type field is required.',
          },
        ],
      },
      { role: 'user', content: 'try again' },
    ];
    const history = buildSpecialistHistory(prior);
    const assistant = history.find((m) => m.role === 'assistant');
    assert.ok(assistant);
    assert.match(assistant.content, /\[Tools used this turn\]/);
    assert.match(assistant.content, /list_team_members\(\{\}\) → ok/);
    assert.match(assistant.content, /create_task.*FAILED: The issue type field is required/);
    assert.match(assistant.content, /10000000048/);
  });
});
