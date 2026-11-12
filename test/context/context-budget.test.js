import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { computeContextBudget, measuredInputTokens } = await import('../../src/utils/contextBudget.js');
const { getModelLimits, _setLiveModelLimitsForTest, modelSupports } = await import('../../src/llm/modelLimits.js');
const {
  groupIntoTurns, fitTurnsToBudget, clearOldToolResults, planContextWindow,
} = await import('../../src/utils/contextWindow.js');
const { buildContextSnapshot } = await import('../../src/nova/agents/contextSnapshot.js');
const { countMessagesTokens } = await import('../../src/utils/tokenCounter.js');

const toolTurn = (n, size = 100) => [
  { role: 'user', content: `question ${n}` },
  { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'list_invoices', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'x'.repeat(size) }] },
  { role: 'assistant', content: `answer ${n}` },
];

describe('model limits', () => {
  beforeEach(() => {
    _setLiveModelLimitsForTest([
      ['claude-sonnet-4-6', { contextWindow: 1_000_000, maxOutput: 128_000, capabilities: { thinking: true, effort: true } }],
      ['claude-haiku-4-5-20251001', { contextWindow: 200_000, maxOutput: 64_000, capabilities: { thinking: true, effort: false } }],
    ]);
  });

  it('prefers live API values and resolves aliases to dated snapshots', () => {
    assert.equal(getModelLimits('claude-sonnet-4-6').source, 'api');
    const haiku = getModelLimits('claude-haiku-4-5');
    assert.equal(haiku.contextWindow, 200_000);
    assert.equal(haiku.source, 'api');
  });

  it('falls back to catalog, then a conservative default', () => {
    assert.equal(getModelLimits('claude-opus-5-5').source, 'catalog');
    const unknown = getModelLimits('totally-new-model');
    assert.equal(unknown.source, 'default');
    assert.equal(unknown.contextWindow, 200_000);
  });

  it('exposes capability flags (null when unknown)', () => {
    assert.equal(modelSupports('claude-haiku-4-5', 'effort'), false);
    assert.equal(modelSupports('claude-sonnet-4-6', 'effort'), true);
    assert.equal(modelSupports('claude-opus-5-5', 'effort'), null);
  });
});

describe('computeContextBudget', () => {
  beforeEach(() => {
    _setLiveModelLimitsForTest([
      ['claude-sonnet-4-6', { contextWindow: 1_000_000, maxOutput: 128_000, capabilities: null }],
      ['claude-haiku-4-5-20251001', { contextWindow: 200_000, maxOutput: 64_000, capabilities: null }],
    ]);
  });

  it('uses the standard working window: min(model window, configured window), minus reply + margin', () => {
    const sonnet = computeContextBudget({ model: 'claude-sonnet-4-6', reservedOutput: 8192 });
    assert.equal(sonnet.contextWindow, 1_000_000);          // the model can hold 1M…
    assert.equal(sonnet.workingWindow, 200_000);            // …but a chat works in the standard 200k window
    assert.equal(sonnet.usable, 200_000 - 8192 - sonnet.margin);
    assert.equal(sonnet.reserved, 200_000 - sonnet.usable); // reply + compaction headroom
    assert.ok(sonnet.soft < sonnet.hard && sonnet.hard < sonnet.usable);

    const full = computeContextBudget({ model: 'claude-sonnet-4-6', reservedOutput: 8192, windowTokens: 5_000_000 });
    assert.equal(full.workingWindow, 1_000_000);            // a bigger setting is still capped by the model

    const small = computeContextBudget({ model: 'claude-haiku-4-5', reservedOutput: 8192, windowTokens: 10_000_000 });
    assert.equal(small.workingWindow, 200_000);             // Haiku 4.5's real window
    assert.ok(small.usable < 200_000 - 8192);
  });

  it('never reserves more output than the model allows', () => {
    const b = computeContextBudget({ model: 'claude-haiku-4-5', reservedOutput: 999_999 });
    assert.equal(b.reservedOutput, 64_000);
  });

  it('measures exact input from usage incl. cache fields', () => {
    assert.equal(measuredInputTokens({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5 }), 105);
    assert.equal(measuredInputTokens(null), 0);
  });
});

describe('turn-based windowing', () => {
  it('groups tool pairs inside their turn', () => {
    const turns = groupIntoTurns([...toolTurn(1), ...toolTurn(2)]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].length, 4);
  });

  it('drops oldest whole turns and never splits tool_use/tool_result pairs', () => {
    const msgs = [1, 2, 3, 4, 5].flatMap((n) => toolTurn(n, 800));
    const oneTurn = countMessagesTokens(toolTurn(1, 800));
    const fit = fitTurnsToBudget(msgs, oneTurn * 2 + 5);
    assert.equal(fit.keptTurns, 2);
    assert.equal(fit.droppedTurns, 3);
    assert.equal(fit.messages[0].role, 'user');
    assert.equal(typeof fit.messages[0].content, 'string');
    const ids = fit.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const uses = ids.filter((b) => b.type === 'tool_use').map((b) => b.id);
    const results = ids.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    assert.deepEqual(uses, results);
  });

  it('always keeps the newest turn even if it alone exceeds the budget', () => {
    const fit = fitTurnsToBudget(toolTurn(1, 50_000), 100);
    assert.equal(fit.keptTurns, 1);
  });

  it('plans against the model budget including system + tools + context block', () => {
    _setLiveModelLimitsForTest([['claude-haiku-4-5-20251001', { contextWindow: 200_000, maxOutput: 64_000, capabilities: null }]]);
    const msgs = Array.from({ length: 40 }, (_, i) => toolTurn(i, 20_000)).flat();
    const plan = planContextWindow({
      messages: msgs,
      systemPrompt: 'x'.repeat(40_000),
      extraText: 'y'.repeat(40_000),
      model: 'claude-haiku-4-5',
      reservedOutput: 8192,
    });
    assert.ok(plan.droppedTurns > 0);
    assert.ok(plan.tokens + plan.fixedTokens <= plan.budget.usable + 1);
  });
});

describe('clearOldToolResults', () => {
  it('stubs old tool results, keeps recent ones, does not mutate input', () => {
    const msgs = [1, 2, 3, 4].flatMap((n) => toolTurn(n, 500));
    const snapshot = JSON.stringify(msgs);
    const { messages, cleared } = clearOldToolResults(msgs, { keepRecent: 2 });
    assert.equal(cleared, 2);
    assert.equal(JSON.stringify(msgs), snapshot);
    const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result');
    assert.match(results[0].content, /cleared/);
    assert.equal(results[3].content.length, 500);
    assert.equal(results[0].tool_use_id, 't1');
  });
});

describe('context snapshot', () => {
  it('uses exact usage when present and reports the budget', () => {
    _setLiveModelLimitsForTest([['claude-sonnet-4-6', { contextWindow: 1_000_000, maxOutput: 128_000, capabilities: null }]]);
    const snap = buildContextSnapshot({
      model: 'claude-sonnet-4-6',
      usage: { last_call: { model: 'claude-sonnet-4-6', input_tokens: 42_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0, output_tokens: 500 } },
      systemPrompt: 'sys',
    });
    assert.equal(snap.used_tokens, 42_000);
    assert.equal(snap.used_is_exact, true);
    assert.equal(snap.context_window, 1_000_000);
    assert.equal(snap.cache_read_tokens, 30_000);
    assert.equal(snap.free_tokens, snap.usable_budget - 42_000);
  });
});
