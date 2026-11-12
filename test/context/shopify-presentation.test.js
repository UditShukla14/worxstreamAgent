/**
 * Shopify analytics: one report, not two. Runtime widgets win; model text is commentary only.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

await import('../../src/mcp/tools/index.js');
const {
  buildShopifyAnalyticsPresentation,
  mergeShopifyPresentationWithCommentary,
  modelFacingToolResult,
  stripModelTables,
} = await import('../../src/nova/agents/shopifyAnalyticsPresentation.js');
const { registerTool } = await import('../../src/mcp/server.js');
const { AGENT_DEFINITIONS } = await import('../../src/nova/agents/agentDefinitions.js');
const { BaseAgent } = await import('../../src/nova/agents/BaseAgent.js');
const { anthropicClient } = await import('../../src/llm/anthropicClient.js');

const columns = [
  { name: 'session_country', dataType: 'STRING', displayName: 'Session country' },
  { name: 'sessions', dataType: 'INTEGER', displayName: 'Sessions' },
  { name: 'completed_checkout', dataType: 'INTEGER', displayName: 'Sessions that completed checkout' },
  { name: 'conversion_rate', dataType: 'PERCENT', displayName: 'Conversion rate' },
];
const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ session_country: `Country ${i}`, sessions: 10 + i, completed_checkout: i % 4 === 0 ? 1 : 0, conversion_rate: 0.01 }));
const result = (n) => ({ success: true, data: { columns, rows: makeRows(n) } });

describe('deterministic Shopify widgets', () => {
  it('multi-row breakdown shows column TOTALS (not the last row) and skips rates', () => {
    const xml = buildShopifyAnalyticsPresentation(result(5), { title: 'Shopify analytics' });
    const stats = xml.match(/<stats>[\s\S]*?<\/stats>/)[0];
    assert.match(stats, /label="Total sessions" value="60" icon="users"/);        // 10+11+12+13+14
    assert.match(stats, /label="Total sessions that completed checkout" value="2"/); // rows 0 and 4
    assert.doesNotMatch(stats, /Conversion rate/);                   // a rate cannot be summed
    assert.doesNotMatch(stats, /value="14"/);                        // the old bug: last row only
  });

  it('single-row result still shows that row', () => {
    const xml = buildShopifyAnalyticsPresentation({ success: true, data: { columns, rows: makeRows(1) } });
    assert.match(xml, /label="Sessions" value="10"/);
  });

  it('notes truncation under the table', () => {
    const xml = buildShopifyAnalyticsPresentation(result(80));
    assert.match(xml, /Showing 30 of 80 rows\./);
  });
});

describe('merge: runtime widgets + model commentary only', () => {
  const widgets = buildShopifyAnalyticsPresentation(result(5));

  it('drops tables the model wrote (markdown and XML) and its own cards/charts', () => {
    const model = [
      'Here are the top rows:',
      '',
      '| Country | Sessions |',
      '|---|---|',
      '| Brazil | 27 |',
      '',
      '<table><headers><th>A</th></headers><row><td>1</td></row></table>',
      '<stats><stat label="x" value="1"/></stats>',
      'Brazil is sending notable traffic.',
    ].join('\n');
    const merged = mergeShopifyPresentationWithCommentary(widgets, model);
    assert.equal((merged.match(/<table\b/gi) || []).length, 1, 'only the runtime table remains');
    assert.doesNotMatch(merged, /\| Brazil/);
    assert.match(merged, /Brazil is sending notable traffic\./);
  });

  it('stripModelTables leaves ordinary prose and lists alone', () => {
    assert.equal(stripModelTables('Traffic is up.\n\n- Brazil\n- India'), 'Traffic is up.\n\n- Brazil\n- India');
  });
});

describe('model-facing analytics result (context)', () => {
  it('trims big results to the first rows plus a count; leaves small and other tools alone', () => {
    const big = modelFacingToolResult('run_shopify_analytics', result(80));
    assert.equal(big.data.rows.length, 15);
    assert.equal(big.data.total_rows, 80);
    assert.match(big.data.note, /every row in the rendered report/);
    const small = result(10);
    assert.equal(modelFacingToolResult('run_shopify_analytics', small), small);
    const other = result(80);
    assert.equal(modelFacingToolResult('list_invoices', other), other);
  });
});

describe('live streaming after an analytics tool', () => {
  let originalStream;
  beforeEach(() => { originalStream = anthropicClient.messages.stream; });
  afterEach(() => { anthropicClient.messages.stream = originalStream; });

  const fake = (message, texts) => ({
    async *[Symbol.asyncIterator]() { for (const t of texts) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }; },
    finalMessage: async () => message,
    currentMessage: message,
  });

  it('holds the model text (the pipeline swaps in widgets) and sends the model only the trimmed rows', async () => {
    registerTool('run_shopify_analytics', { title: 't', description: 'fake', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: JSON.stringify(result(80)) }],
    }));
    const seen = [];
    let call = 0;
    anthropicClient.messages.stream = (params) => {
      seen.push(params);
      return ++call === 1
        ? fake({ id: 'm1', model: 'claude-test', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tu1', name: 'run_shopify_analytics', input: { query: 'FROM sessions SHOW sessions' } }] }, [])
        : fake({ id: 'm2', model: 'claude-test', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'Brazil leads.' }] }, ['Brazil ', 'leads.']);
    };
    const events = [];
    const out = await new BaseAgent('nova', AGENT_DEFINITIONS.nova).runWithEvents('sessions by country', { _streamText: true }, (e) => events.push(e));

    assert.equal(events.some((e) => e.type === 'text'), false, 'answer text is not streamed live');
    assert.equal(out.rawText, 'Brazil leads.');
    assert.equal(out.streamedText, undefined);
    // full result stays available for the widgets
    assert.equal(out.toolResultPayloads[0].data.rows.length, 80);
    // the model read only the trimmed copy
    const toolResult = seen[1].messages.at(-1).content[0];
    const sent = JSON.parse(toolResult.content);
    assert.equal(sent.data.rows.length, 15);
    assert.equal(sent.data.total_rows, 80);
  });
});
