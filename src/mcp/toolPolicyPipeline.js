/**
 * Tool policy pipeline
 *
 * Central place to enforce cross-tool behaviors so prompts can't drift.
 * Kept intentionally minimal + backward-compatible.
 */
 
import { normalizeListInput } from '../agents/policies/listPolicies.js';
 
const LATEST_HINTS = [
  /\blatest\b/i,
  /\bmost\s+recent\b/i,
  /\brecent\b/i,
  /\bnewest\b/i,
];
 
function wantsLatest(userMessage = '') {
  const msg = String(userMessage || '');
  return LATEST_HINTS.some((re) => re.test(msg));
}

/**
 * @typedef {object} ToolCallContext
 * @property {string} [agent]
 * @property {string} [userMessage]
 */
 
/**
 * Apply pre-call policies (input normalization, safety caps).
 *
 * @param {string} toolName
 * @param {any} input
 * @param {ToolCallContext} [ctx]
 */
export function beforeToolCall(toolName, input, ctx = {}) {
  const name = String(toolName || '');
  const original = input ?? {};
 
  // Normalize list tool inputs consistently (even if agent prompt drifts).
  if (name.startsWith('list_') && original && typeof original === 'object') {
    const normalized = normalizeListInput(original);
    const cleaned = { ...normalized };

    // API handles ordering by default; do not pass sort from the agent/prompt.
    if (cleaned.sort != null) delete cleaned.sort;

    // We no longer support `take`; tools should use `limit` only.
    if (cleaned.take != null) delete cleaned.take;

    // For “latest/recent”, rely on backend default ordering; just ensure first page.
    if (wantsLatest(ctx.userMessage)) {
      cleaned.page = cleaned.page ?? 1;
    }

    return cleaned;
  }
 
  return original;
}
 
/**
 * Apply post-call policies (standardize error shape, attach metadata).
 *
 * @param {string} toolName
 * @param {any} input
 * @param {any} result
 * @param {ToolCallContext} [ctx]
 */
export function afterToolCall(toolName, input, result, ctx = {}) {
  if (!result || typeof result !== 'object') return result;
 
  // Preserve existing result shape, but ensure success boolean exists when possible.
  if (typeof result.success !== 'boolean') {
    return { success: true, data: result };
  }
 
  return result;
}
 
/**
 * Convert thrown errors into a consistent tool error object.
 *
 * @param {string} toolName
 * @param {any} input
 * @param {any} error
 */
export function onToolError(toolName, input, error) {
  const message = error?.message ? String(error.message) : String(error || 'Tool execution failed');
  return {
    success: false,
    error: message,
    error_type: 'tool_exception',
  };
}
 
