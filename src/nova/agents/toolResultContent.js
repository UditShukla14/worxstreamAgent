/**
 * Build the model-facing `tool_result` block for a tool call.
 * - flags failures with `is_error` so the model treats them as errors
 * - caps oversized payloads so one big list does not bloat every later round
 *   (the full result still goes to toolResultPayloads for UI presentation)
 */

import { config } from '../../config/index.js';

const DEFAULT_MAX_CHARS = 30000;

function maxChars() {
  const n = config.agentRuntime?.toolResultMaxChars;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CHARS;
}

export function serializeToolResult(result, limit = maxChars()) {
  const json = JSON.stringify(result);
  if (json.length <= limit) return json;
  return JSON.stringify({
    success: result?.success !== false,
    truncated: true,
    original_chars: json.length,
    note: 'Result was too large and was cut off. Narrow the filters, lower the page size, or request fewer records.',
    partial: json.slice(0, limit),
  });
}

export function buildToolResultBlock(toolUseId, result) {
  const block = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: serializeToolResult(result),
  };
  if (result && result.success === false) block.is_error = true;
  return block;
}
