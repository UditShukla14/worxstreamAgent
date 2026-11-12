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

/**
 * One-line, user-facing summary of a tool result for the chat timeline
 * ("25 of 340 results", the error text, …). Never includes raw payloads.
 */
export function summarizeToolResult(result) {
  if (!result) return '';
  if (result.success === false) return String(result.error || 'Failed').replace(/\s+/g, ' ').slice(0, 160);
  const d = result.data;
  const findArr = (x, depth = 0) => {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object' && depth < 4) {
      for (const k of ['data', 'items', 'results', 'rows', 'list', 'records']) {
        const a = findArr(x[k], depth + 1);
        if (a) return a;
      }
    }
    return null;
  };
  const arr = findArr(d);
  if (arr) {
    const total = [d?.total, d?.meta?.total, d?.data?.total, d?.data?.meta?.total].find((n) => Number.isFinite(Number(n)));
    const word = (n) => (n === 1 ? 'result' : 'results');
    return total != null && Number(total) > arr.length
      ? `${arr.length} of ${Number(total)} ${word(Number(total))}`
      : `${arr.length} ${word(arr.length)}`;
  }
  const msg = d?.message ?? result.message;
  if (typeof msg === 'string' && msg.trim()) return msg.replace(/\s+/g, ' ').slice(0, 120);
  return 'Done';
}
