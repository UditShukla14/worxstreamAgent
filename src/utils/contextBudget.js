/**
 * Context budget — the standard conversation-window flow.
 *
 *   workingWindow = min( model window , CONTEXT_WINDOW_TOKENS )          what the user sees as "the window"
 *   usable        = workingWindow − reservedOutput − safetyMargin         room for the conversation itself
 *   soft / hard   = share of `usable` at which the conversation is auto-compacted / old tool results cleared
 *
 * The model window and max output come from the Models API (llm/modelLimits.js). CONTEXT_WINDOW_TOKENS defaults to
 * 200k — the standard window Claude's own products work in — even on 1M-window models; raise it to use the full 1M
 * (every turn then re-reads more tokens, so it costs more). The slice between `usable` and `workingWindow` is
 * reserved for the reply and compaction.
 */

import { config } from '../config/index.js';
import { getModelLimits } from '../llm/modelLimits.js';

/**
 * @param {object} opts
 * @param {string} opts.model                - model id that will serve the call
 * @param {number} [opts.reservedOutput]     - max_tokens for this call (not the model max)
 * @param {number} [opts.windowTokens]       - override the configured working window
 * @returns {{
 *   model: string, contextWindow: number, workingWindow: number, maxOutput: number, reservedOutput: number,
 *   margin: number, reserved: number, usable: number, soft: number, hard: number,
 *   limitsSource: string, capabilities: object|null,
 * }}
 */
export function computeContextBudget({ model, reservedOutput, windowTokens } = {}) {
  const limits = getModelLimits(model);
  const cw = config.contextWindow;
  const out = Math.min(
    Number.isFinite(reservedOutput) && reservedOutput > 0 ? reservedOutput : (config.anthropic.maxTokens?.agent ?? 8192),
    limits.maxOutput,
  );
  const configured = Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : (cw.maxTokens || 200_000);
  const workingWindow = Math.min(limits.contextWindow, configured);
  const margin = Math.ceil(workingWindow * (cw.safetyMargin ?? 0.05));
  const usable = Math.max(1_000, workingWindow - out - margin);
  return {
    model: String(model || ''),
    contextWindow: limits.contextWindow,
    workingWindow,
    maxOutput: limits.maxOutput,
    reservedOutput: out,
    margin,
    reserved: Math.max(0, workingWindow - usable),
    usable,
    soft: Math.floor(usable * (cw.softRatio ?? 0.8)),
    hard: Math.floor(usable * (cw.hardRatio ?? 0.92)),
    limitsSource: limits.source,
    capabilities: limits.capabilities,
  };
}

/** Exact size of what was sent, from an Anthropic response.usage object. */
export function measuredInputTokens(usage) {
  if (!usage) return 0;
  return (Number(usage.input_tokens) || 0)
    + (Number(usage.cache_read_input_tokens) || 0)
    + (Number(usage.cache_creation_input_tokens) || 0);
}
