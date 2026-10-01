import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config/index.js';
import { streamMessage } from '../src/llm/client.js';

describe('OpenAI-compatible streaming client', () => {
  let originalFetch;
  let receivedBody;

  before(() => {
    originalFetch = globalThis.fetch;
    config.llm.baseUrl = 'http://llm.test/v1';
    globalThis.fetch = async (_url, options) => {
      receivedBody = JSON.parse(options.body);
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_","arguments":"{\\"city\\":"}}]}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"\\"Toronto\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'));
          // Deliberately omit the trailing newline; the client must flush it.
          controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}'));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('reassembles streamed tool names/arguments and requests usage', async () => {
    const { completion } = await streamMessage({
      model: 'test-model',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'weather' }],
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
          strict: true,
        },
      }],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });

    assert.equal(receivedBody.stream_options.include_usage, true);
    assert.equal(receivedBody.tools[0].function.strict, true);
    assert.equal(receivedBody.parallel_tool_calls, false);
    assert.equal(completion.choices[0].finish_reason, 'tool_calls');
    assert.equal(completion.choices[0].message.tool_calls[0].function.name, 'get_weather');
    assert.deepEqual(
      JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments),
      { city: 'Toronto' },
    );
    assert.equal(completion.usage.prompt_tokens, 12);
    assert.equal(completion.usage.completion_tokens, 4);
  });
});
