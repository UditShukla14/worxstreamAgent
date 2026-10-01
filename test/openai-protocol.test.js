import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatCompletionBody,
  getAssistantMessage,
  getResponseText,
} from '../src/llm/client.js';
import {
  parseToolArguments,
  INVALID_TOOL_ARGUMENTS_KEY,
} from '../src/llm/toolArguments.js';

describe('native OpenAI protocol', () => {
  it('keeps native assistant tool calls and tool results unchanged', () => {
    const messages = [
      { role: 'system', content: 'You are Nova' },
      { role: 'user', content: 'list invoices' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'list_invoices', arguments: '{"limit":5}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' },
    ];
    const body = buildChatCompletionBody({ model: 'test', messages });
    assert.deepEqual(body.messages, messages);
  });

  it('drops orphaned native tool messages', () => {
    const body = buildChatCompletionBody({
      model: 'test',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'tool', tool_call_id: 'missing', content: 'orphan' },
      ],
    });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  });

  it('drops assistant tool calls that have no result in stored history', () => {
    const body = buildChatCompletionBody({
      model: 'test',
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'unfinished',
          type: 'function',
          function: { name: 'write_something', arguments: '{}' },
        }],
      }, { role: 'user', content: 'continue' }],
    });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'continue' }]);
  });

  it('reads native completion text and assistant messages', () => {
    const completion = {
      choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
    };
    assert.equal(getResponseText(completion), 'Hello');
    assert.equal(getAssistantMessage(completion).role, 'assistant');
  });

  it('parses object and JSON-string tool arguments', () => {
    assert.deepEqual(parseToolArguments({ city: 'Toronto' }), { city: 'Toronto' });
    assert.deepEqual(parseToolArguments('{"city":"Toronto"}'), { city: 'Toronto' });
  });

  it('marks malformed arguments so they cannot execute', () => {
    const input = parseToolArguments('{"city":');
    assert.match(input[INVALID_TOOL_ARGUMENTS_KEY], /Invalid JSON/);
  });

  it('builds native tool settings without translation', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'ping',
        description: 'ping',
        parameters: { type: 'object', properties: {}, required: [] },
        strict: true,
      },
    }];
    const body = buildChatCompletionBody({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });
    assert.deepEqual(body.tools, tools);
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.parallel_tool_calls, false);
  });
});
