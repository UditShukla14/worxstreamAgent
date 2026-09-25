/**
 * Unit tests for OpenAI/Claude-style stream helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDeltaCoalesceBuffer,
  findEarliestOpenBlock,
  resolveFormatterMaxTokens,
  splitStreamingUiContent,
} from '../src/nova/agents/streamSectionBuffer.js';

describe('streamSectionBuffer (OpenAI/Claude style)', () => {
  it('finds earliest open block tag', () => {
    const hit = findEarliestOpenBlock('Hello <stats><stat label="A" value="1"/></stats>');
    assert.equal(hit?.tag, 'stats');
    assert.equal(hit?.index, 6);
  });

  it('splitStreamingUiContent holds open table like a code fence', () => {
    const partial = '<table title="T"><headers><th>A</th></headers><row><td>1</td>';
    const { committed, pending } = splitStreamingUiContent(partial, { streaming: true });
    assert.equal(committed, '');
    assert.equal(pending?.tag, 'table');
    assert.match(pending?.body || '', /<headers>/);
  });

  it('splitStreamingUiContent commits closed blocks and pending open chart', () => {
    const text =
      '<stats><stat label="X" value="1"/></stats>\n'
      + '<chart type="bar" title="Sales"><chart-data label="A">';
    const { committed, pending } = splitStreamingUiContent(text, { streaming: true });
    assert.match(committed, /<\/stats>/);
    assert.equal(pending?.tag, 'chart');
    assert.match(pending?.body || '', /chart-data/);
  });

  it('splitStreamingUiContent commits everything when not streaming', () => {
    const partial = '<table><headers><th>A</th></headers>';
    const { committed, pending } = splitStreamingUiContent(partial, { streaming: false });
    assert.equal(committed, partial);
    assert.equal(pending, null);
  });

  it('createDeltaCoalesceBuffer flushes on size threshold', async () => {
    const chunks = [];
    const buf = createDeltaCoalesceBuffer((c) => chunks.push(c), {
      maxDelayMs: 5000,
      maxChars: 8,
    });
    buf.push('1234567');
    assert.deepEqual(chunks, []);
    buf.push('89');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], '123456789');
  });

  it('createDeltaCoalesceBuffer flush empties pending', () => {
    const chunks = [];
    const buf = createDeltaCoalesceBuffer((c) => chunks.push(c), {
      maxDelayMs: 5000,
      maxChars: 1000,
    });
    buf.push('hi');
    assert.equal(chunks.length, 0);
    buf.flush();
    assert.deepEqual(chunks, ['hi']);
  });

  it('resolveFormatterMaxTokens scales with raw size', () => {
    const small = resolveFormatterMaxTokens('hi', 4096);
    assert.equal(small, 4096);
    const large = resolveFormatterMaxTokens('x'.repeat(60000), 4096);
    assert.ok(large > 4096);
    assert.ok(large <= 32000);
  });
});
