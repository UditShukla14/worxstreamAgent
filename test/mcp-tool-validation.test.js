import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { executeMcpTool, getOpenAITools, registerTool } from '../src/mcp/server.js';
import { INVALID_TOOL_ARGUMENTS_KEY } from '../src/llm/toolArguments.js';

describe('in-process MCP tool validation', () => {
  let calls = 0;
  registerTool(
    '__test_validated_tool',
    {
      description: 'Validation test tool',
      inputSchema: { id: z.number(), note: z.string().optional() },
    },
    async (input) => {
      calls++;
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, input }) }] };
    },
  );

  it('does not execute malformed JSON arguments', async () => {
    const result = await executeMcpTool('__test_validated_tool', {
      [INVALID_TOOL_ARGUMENTS_KEY]: 'Invalid JSON tool arguments',
      raw: '{"id":',
    });
    assert.equal(result.success, false);
    assert.equal(result.error_type, 'invalid_tool_arguments');
    assert.equal(calls, 0);
  });

  it('does not execute schema-invalid arguments', async () => {
    const result = await executeMcpTool('__test_validated_tool', { id: '123' });
    assert.equal(result.success, false);
    assert.equal(result.error_type, 'invalid_tool_arguments');
    assert.equal(result.details[0].path, 'id');
    assert.equal(calls, 0);
  });

  it('executes validated data and strips unknown fields', async () => {
    const result = await executeMcpTool('__test_validated_tool', {
      id: 123,
      note: 'ok',
      hallucinated: true,
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.input, { id: 123, note: 'ok' });
    assert.equal(calls, 1);
  });

  it('publishes a native strict OpenAI function schema', () => {
    const [tool] = getOpenAITools(['__test_validated_tool'], { strict: true });
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.name, '__test_validated_tool');
    assert.equal(tool.function.strict, true);
    assert.equal(tool.function.parameters.additionalProperties, false);
    assert.deepEqual(tool.function.parameters.required.sort(), ['id', 'note']);
    assert.ok(tool.function.parameters.properties.note.anyOf.some((x) => x.type === 'null'));
  });
});
