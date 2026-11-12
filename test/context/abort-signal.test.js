/**
 * Stop button: BaseAgent.runWithEvents honours an AbortSignal.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

await import('../../src/mcp/tools/index.js');
const { AGENT_DEFINITIONS } = await import('../../src/nova/agents/agentDefinitions.js');
const { BaseAgent } = await import('../../src/nova/agents/BaseAgent.js');
const { anthropicClient } = await import('../../src/llm/anthropicClient.js');

const toolUseResponse = () => ({
  id: 'msg_test',
  model: 'claude-test',
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 },
  content: [
    { type: 'tool_use', id: 'tu_1', name: 'resolve_entity', input: { query: 'a' } },
    { type: 'tool_use', id: 'tu_2', name: 'resolve_entity', input: { query: 'b' } },
  ],
});

describe('runWithEvents abort', () => {
  let originalCreate;
  let calls;
  beforeEach(() => {
    originalCreate = anthropicClient.messages.create;
    calls = [];
  });
  afterEach(() => {
    anthropicClient.messages.create = originalCreate;
  });

  const run = (signal, onEvent = () => {}) => {
    const agent = new BaseAgent('nova', AGENT_DEFINITIONS.nova);
    return agent.runWithEvents('hello', { _abortSignal: signal }, onEvent);
  };

  it('does not call the model when already aborted', async () => {
    anthropicClient.messages.create = async (...a) => { calls.push(a); return toolUseResponse(); };
    const ac = new AbortController();
    ac.abort();
    const result = await run(ac.signal);
    assert.equal(result.aborted, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(result.toolsUsed, []);
  });

  it('runs no tools when aborted during the model call, and forwards the signal', async () => {
    const ac = new AbortController();
    anthropicClient.messages.create = async (...a) => {
      calls.push(a);
      ac.abort(); // user hits Stop while the model is responding
      return toolUseResponse();
    };
    const events = [];
    const result = await run(ac.signal, (e) => events.push(e));
    assert.equal(result.aborted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1]?.signal, ac.signal);
    assert.deepEqual(result.toolsUsed, []);
    assert.equal(events.filter((e) => e.type === 'tool_use').length, 0);
    assert.deepEqual(result.agentTranscript, []);
  });

  it('returns aborted (not a throw) when the SDK rejects with an abort error', async () => {
    const ac = new AbortController();
    anthropicClient.messages.create = async () => {
      ac.abort();
      const err = new Error('Request was aborted.');
      err.name = 'APIUserAbortError';
      throw err;
    };
    const result = await run(ac.signal);
    assert.equal(result.aborted, true);
    assert.equal(result.rawText, '');
  });

  it('is unaffected when no signal is supplied', async () => {
    anthropicClient.messages.create = async (...a) => {
      calls.push(a);
      return {
        id: 'm', model: 'claude-test', stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: 'hi' }],
      };
    };
    const result = await run(null);
    assert.equal(result.aborted, undefined);
    assert.equal(result.rawText, 'hi');
    assert.equal(calls[0][1], undefined);
  });
});
