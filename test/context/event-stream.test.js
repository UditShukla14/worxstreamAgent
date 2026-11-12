/**
 * Chat event stream: live text, tool calls paired by id with timing + summary, usage ticks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

await import('../../src/mcp/tools/index.js');
const { AGENT_DEFINITIONS } = await import('../../src/nova/agents/agentDefinitions.js');
const { BaseAgent } = await import('../../src/nova/agents/BaseAgent.js');
const { anthropicClient } = await import('../../src/llm/anthropicClient.js');
const { summarizeToolResult } = await import('../../src/nova/agents/toolResultContent.js');
const { thinkingParamsFor, maxTokensWithThinking } = await import('../../src/llm/thinking.js');

function fakeStream(message, texts) {
  // all deltas belong to one text block (index 0), like a real single-block reply
  const events = texts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
  return {
    async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
    finalMessage: async () => message,
    currentMessage: message,
  };
}

const toolRound = {
  id: 'msg_1', model: 'claude-test', stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 },
  content: [
    { type: 'text', text: 'Let me check.' },
    { type: 'tool_use', id: 'tu_a', name: 'resolve_entity', input: { entity_type: 'customer', query: 'acme' } },
    { type: 'tool_use', id: 'tu_b', name: 'resolve_entity', input: { entity_type: 'customer', query: 'bolt' } },
  ],
};
const answerRound = {
  id: 'msg_2', model: 'claude-test', stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 30 },
  content: [{ type: 'text', text: 'Found both.' }],
};

describe('runWithEvents live event stream', () => {
  let originalStream;
  let originalCreate;
  beforeEach(() => { originalStream = anthropicClient.messages.stream; originalCreate = anthropicClient.messages.create; });
  afterEach(() => { anthropicClient.messages.stream = originalStream; anthropicClient.messages.create = originalCreate; });

  const run = (ctx, onEvent) => new BaseAgent('nova', AGENT_DEFINITIONS.nova).runWithEvents('hi', ctx, onEvent);

  it('streams text, emits every tool_use (with ids) before results, and pairs results by id', async () => {
    let call = 0;
    anthropicClient.messages.stream = () => (++call === 1
      ? fakeStream(toolRound, ['Let me ', 'check.'])
      : fakeStream(answerRound, ['Found both.']));
    const events = [];
    const result = await run({ _streamText: true }, (e) => events.push(e));

    const types = events.map((e) => e.type);
    const firstResult = types.indexOf('tool_result');
    const uses = events.filter((e) => e.type === 'tool_use');
    const results = events.filter((e) => e.type === 'tool_result');

    assert.equal(uses.length, 2);
    assert.equal(types.lastIndexOf('tool_use') < firstResult, true, 'parallel calls are announced before any finishes');
    assert.deepEqual(uses.map((u) => u.id).sort(), ['tu_a', 'tu_b']);
    assert.deepEqual(results.map((r) => r.id).sort(), ['tu_a', 'tu_b']);
    for (const r of results) {
      assert.equal(typeof r.duration_ms, 'number');
      assert.equal(typeof r.summary, 'string');
      assert.equal(r.tool, 'resolve_entity');
    }
    // text: narration streamed before the tools, answer after
    const text = events.filter((e) => e.type === 'text').map((e) => e.content).join('');
    assert.equal(text, 'Let me check.Found both.');
    assert.ok(types.indexOf('text') < types.indexOf('tool_use'));
    assert.ok(types.lastIndexOf('text') > types.lastIndexOf('tool_result'));
    // usage ticks are cumulative
    const usage = events.filter((e) => e.type === 'usage');
    assert.equal(usage.length, 2);
    assert.equal(usage[1].output_tokens, 50);
    // the pipeline compares against the streamed FINAL answer only (narration excluded)
    assert.equal(result.streamedText, true);
    assert.equal(result.streamedAnswer, 'Found both.');
    assert.equal(result.rawText, 'Found both.');
  });

  it('does not use streaming or emit text events unless _streamText is set', async () => {
    anthropicClient.messages.stream = () => { throw new Error('stream must not be used'); };
    anthropicClient.messages.create = async () => answerRound;
    const events = [];
    const result = await run({}, (e) => events.push(e));
    assert.equal(events.some((e) => e.type === 'text'), false);
    assert.equal(result.streamedText, undefined);
    assert.equal(result.rawText, 'Found both.');
  });

  it('keeps text from a max_tokens round in the final answer', async () => {
    let call = 0;
    anthropicClient.messages.stream = () => (++call === 1
      ? fakeStream({ id: 'm1', model: 'claude-test', stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'Part one, ' }] }, ['Part one, '])
      : fakeStream({ id: 'm2', model: 'claude-test', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'part two.' }] }, ['part two.']));
    const result = await run({ _streamText: true }, () => {});
    assert.equal(result.rawText, 'Part one, part two.');
    assert.equal(result.streamedAnswer, 'Part one, part two.');
  });
});

describe('summarizeToolResult', () => {
  it('summarises list results, totals, messages and errors in one line', () => {
    assert.equal(summarizeToolResult({ success: true, data: { data: [1, 2, 3] } }), '3 results');
    assert.equal(summarizeToolResult({ success: true, data: { data: [1], } }), '1 result');
    assert.equal(summarizeToolResult({ success: true, data: { data: [1, 2], total: 340 } }), '2 of 340 results');
    assert.equal(summarizeToolResult({ success: true, data: { message: 'Estimate created' } }), 'Estimate created');
    assert.equal(summarizeToolResult({ success: true, data: { id: 5 } }), 'Done');
    assert.equal(summarizeToolResult({ success: false, error: 'Customer   not\nfound' }), 'Customer not found');
  });
});

function rawStream(message, events) {
  return {
    async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
    finalMessage: async () => message,
    currentMessage: message,
  };
}

describe('extended thinking', () => {
  let originalStream;
  beforeEach(() => { originalStream = anthropicClient.messages.stream; });
  afterEach(() => { anthropicClient.messages.stream = originalStream; });

  const thinkingRound = {
    id: 'msg_t', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 40 },
    content: [{ type: 'thinking', thinking: 'Checking the totals.', signature: 'sig' }, { type: 'text', text: 'Answer.' }],
  };
  const thinkingEvents = [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'the totals.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer.' } },
    { type: 'content_block_stop', index: 1 },
  ];

  it('asks for adaptive summarized thinking and streams it before the answer', async () => {
    let captured;
    anthropicClient.messages.stream = (params) => { captured = params; return rawStream(thinkingRound, thinkingEvents); };
    const events = [];
    const result = await new BaseAgent('nova', AGENT_DEFINITIONS.nova).runWithEvents('hi', { _streamText: true }, (e) => events.push(e));

    assert.deepEqual(captured.thinking, { type: 'adaptive', display: 'summarized' });
    assert.ok(captured.max_tokens >= 16000, 'room for reasoning + answer');
    const types = events.map((e) => e.type);
    assert.equal(events.filter((e) => e.type === 'thinking').map((e) => e.content).join(''), 'Checking the totals.');
    assert.equal(types.filter((t) => t === 'thinking_end').length, 1);
    assert.ok(types.indexOf('thinking') < types.indexOf('thinking_end'));
    assert.ok(types.indexOf('thinking_end') < types.indexOf('text'), 'thinking finishes before the answer starts');
    assert.equal(result.streamedAnswer, 'Answer.');
    // the thinking block (with signature) stays in the in-flight conversation for the next tool round
    assert.ok(result.rawText === 'Answer.');
  });

  it('sends no thinking when disabled for the turn or on a model without support', async () => {
    const seen = [];
    anthropicClient.messages.stream = (params) => { seen.push(params); return rawStream({ ...thinkingRound, content: [{ type: 'text', text: 'Hi.' }] }, [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi.' } }]); };
    await new BaseAgent('nova', AGENT_DEFINITIONS.nova).runWithEvents('hi', { _streamText: true, _thinking: false }, () => {});
    await new BaseAgent('nova', AGENT_DEFINITIONS.nova).runWithEvents('hi', { _streamText: true, model: 'claude-haiku-4-5' }, () => {});
    assert.equal(seen[0].thinking, undefined);
    assert.equal(seen[1].thinking, undefined);
  });

  it('only enables thinking for models that support adaptive thinking', () => {
    for (const id of ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2']) {
      assert.deepEqual(thinkingParamsFor(id), { type: 'adaptive', display: 'summarized' }, id);
    }
    for (const id of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-3-5-sonnet', '', 'gpt-4']) {
      assert.equal(thinkingParamsFor(id), null, id);
    }
    assert.ok(maxTokensWithThinking('claude-sonnet-4-6', 8192) >= 16000);
  });
});
