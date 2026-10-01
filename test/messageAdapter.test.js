import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toOpenAITools,
  toOpenAIMessages,
  fromOpenAICompletion,
  buildOpenAIChatBody,
} from '../src/llm/messageAdapter.js';

describe('messageAdapter', () => {
  it('maps Anthropic tools to OpenAI functions and drops tool_search', () => {
    const tools = toOpenAITools([
      {
        name: 'tool_search_tool_bm25',
        description: 'search',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'list_invoices',
        description: 'List invoices',
        input_schema: {
          type: 'object',
          properties: { limit: { type: 'number' } },
          required: [],
        },
      },
    ]);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].type, 'function');
    assert.equal(tools[0].function.name, 'list_invoices');
    assert.equal(tools[0].function.parameters.properties.limit.type, 'number');
  });

  it('maps tool_use / tool_result transcript to OpenAI roles', () => {
    const messages = toOpenAIMessages('You are Nova', [
      { role: 'user', content: 'list invoices' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking up…' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'list_invoices',
            input: { limit: 5 },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: '{"success":true}',
          },
        ],
      },
    ]);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.equal(messages[2].role, 'assistant');
    assert.equal(messages[2].tool_calls[0].id, 'call_1');
    assert.equal(messages[3].role, 'tool');
    assert.equal(messages[3].tool_call_id, 'call_1');
  });

  it('maps OpenAI tool_calls response back to Anthropic stop_reason', () => {
    const msg = fromOpenAICompletion({
      id: 'chatcmpl-1',
      model: 'openai/gpt-oss-120b',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"Toronto"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    assert.equal(msg.stop_reason, 'tool_use');
    assert.equal(msg.content[0].type, 'tool_use');
    assert.equal(msg.content[0].name, 'get_weather');
    assert.deepEqual(msg.content[0].input, { city: 'Toronto' });
    assert.equal(msg.usage.input_tokens, 10);
  });

  it('maps OpenAI array content parts to Anthropic text blocks', () => {
    const msg = fromOpenAICompletion({
      id: 'chatcmpl-2',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
    assert.equal(msg.stop_reason, 'end_turn');
    assert.equal(msg.content[0].type, 'text');
    assert.equal(msg.content[0].text, 'Hello world');
  });

  it('drops orphaned tool_result blocks before OpenAI conversion', () => {
    const messages = toOpenAIMessages(undefined, [
      { role: 'user', content: 'hi' },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'missing',
            content: 'orphan',
          },
        ],
      },
    ]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'hi');
  });

  it('builds chat body with model and tools', () => {
    const body = buildOpenAIChatBody(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 32,
        tools: [
          {
            name: 'ping',
            description: 'ping',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        tool_choice: { type: 'auto' },
      },
      'openai/gpt-oss-120b',
    );
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.max_tokens, 32);
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools[0].function.name, 'ping');
  });
});
