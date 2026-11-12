import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { withPromptCaching, withMessageCache } = await import('../../src/llm/promptCache.js');
const { buildToolResultBlock, serializeToolResult } = await import('../../src/nova/agents/toolResultContent.js');
const { mcpAnnotationsFor } = await import('../../src/mcp/server.js');

describe('prompt caching helpers', () => {
  it('puts cache_control on the system block and last message without mutating input', () => {
    const messages = [{ role: 'user', content: 'hi' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{}' }] }];
    const out = withPromptCaching({ system: 'sys', messages });
    assert.equal(out.system[0].cache_control.type, 'ephemeral');
    assert.equal(out.messages[1].content[0].cache_control.type, 'ephemeral');
    assert.equal(messages[1].content[0].cache_control, undefined);
    assert.equal(out.messages[0], messages[0]);
  });

  it('wraps string content of the last message', () => {
    const out = withMessageCache([{ role: 'user', content: 'hello' }]);
    assert.equal(out[0].content[0].text, 'hello');
    assert.ok(out[0].content[0].cache_control);
  });
});

describe('tool result blocks', () => {
  it('flags failures with is_error', () => {
    assert.equal(buildToolResultBlock('x', { success: false, error: 'boom' }).is_error, true);
    assert.equal(buildToolResultBlock('x', { success: true }).is_error, undefined);
  });

  it('caps oversized results', () => {
    const big = { success: true, data: 'a'.repeat(500) };
    const parsed = JSON.parse(serializeToolResult(big, 100));
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.partial.length, 100);
  });
});

describe('mcp annotations', () => {
  it('marks read tools read-only and deletes destructive', () => {
    assert.equal(mcpAnnotationsFor('list_invoices', { safety: 'read' }).readOnlyHint, true);
    assert.equal(mcpAnnotationsFor('delete_task', { safety: 'write', action: 'delete' }).destructiveHint, true);
    assert.equal(mcpAnnotationsFor('create_task', { safety: 'write' }).destructiveHint, false);
  });
});
