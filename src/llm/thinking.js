/**
 * Extended thinking for interactive chat turns.
 *
 * Claude 4.6+ models use ADAPTIVE thinking (the model decides when and how much to think; `budget_tokens`
 * is deprecated/rejected there). `display: 'summarized'` returns a readable summary of the reasoning —
 * several models default to 'omitted' (empty text), so it is set explicitly. Verified on the live API for
 * claude-sonnet-4-6 (blocks: thinking → text).
 *
 * Older models (4.5 and earlier) need `budget_tokens` + the interleaved-thinking beta for tool loops; they are
 * deliberately NOT enabled (no thinking shown) rather than risking request errors.
 *
 * Only the streaming chat path asks for thinking (the user sees it). Scribe/headless runs never do.
 */

import { config } from '../config/index.js';
import { getModelLimits } from './modelLimits.js';

/** Model ids that accept `thinking: { type: 'adaptive' }`. */
const ADAPTIVE_RE = /^claude-(?:(?:sonnet|opus)-(?:4-[6-9]|[5-9](?:-\d+)?)|haiku-[5-9](?:-\d+)?|fable-|mythos-)/;

/** Thinking tokens count toward max_tokens, so leave room for reasoning + the answer. */
export const THINKING_MIN_MAX_TOKENS = 16_000;

/**
 * @param {string} modelId
 * @returns {{ type: 'adaptive', display: 'summarized' } | null} null = this model gets no thinking
 */
export function thinkingParamsFor(modelId) {
  if (config.anthropic?.thinking === 'off') return null;
  const id = String(modelId || '').toLowerCase();
  if (!ADAPTIVE_RE.test(id)) return null;
  const caps = getModelLimits(id).capabilities;
  if (caps && caps.thinking === false) return null; // the Models API says no
  return { type: 'adaptive', display: 'summarized' };
}

/** max_tokens for a call that thinks: at least THINKING_MIN_MAX_TOKENS, never above the model's output cap. */
export function maxTokensWithThinking(modelId, configured) {
  const cap = getModelLimits(modelId).maxOutput;
  return Math.min(Math.max(Number(configured) || 0, THINKING_MIN_MAX_TOKENS), cap);
}
