/**
 * Context budget — computed per call from the model, never a single constant.
 *
 *   usable = min( window − reservedOutput − safetyMargin , policyCap )
 *
 * `window` and `maxOutput` come from the Models API (llm/modelLimits.js).
 * `policyCap` is an explicit COST guard (MAX_CONTEXT_TOKENS), separate from
 * what the model can physically hold: a 1M-window model should not silently
 * send 1M tokens on every turn.
 */

import { config } from '../config/index.js';
import { getModelLimits } from '../llm/modelLimits.js';

/**
 * @param {object} opts
 * @param {string} opts.model                - model id that will serve the call
 * @param {number} [opts.reservedOutput]     - max_tokens for this call (not the model max)
 * @param {number} [opts.policyCap]          - cost ceiling for input context
 * @returns {{
 *   model: string, contextWindow: number, maxOutput: number, reservedOutput: number,
 *   margin: number, policyCap: number, usable: number, soft: number, hard: number,
 *   limitsSource: string, capabilities: object|null,
 * }}
 */
export function computeContextBudget({ model, reservedOutput, policyCap } = {}) {
  const limits = getModelLimits(model);
  const cw = config.contextWindow;
  const out = Math.min(
    Number.isFinite(reservedOutput) && reservedOutput > 0 ? reservedOutput : (config.anthropic.maxTokens?.agent ?? 8192),
    limits.maxOutput,
  );
  const margin = Math.ceil(limits.contextWindow * (cw.safetyMargin ?? 0.05));
  const cap = Number.isFinite(policyCap) && policyCap > 0 ? policyCap : (cw.maxTokens || 150_000);
  const physical = Math.max(1_000, limits.contextWindow - out - margin);
  const usable = Math.min(physical, cap);
  return {
    model: String(model || ''),
    contextWindow: limits.contextWindow,
    maxOutput: limits.maxOutput,
    reservedOutput: out,
    margin,
    policyCap: cap,
    usable,
    soft: Math.floor(usable * (cw.softRatio ?? 0.65)),
    hard: Math.floor(usable * (cw.hardRatio ?? 0.85)),
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
