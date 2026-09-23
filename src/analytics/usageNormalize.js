/**
 * Normalize Anthropic response.usage into billing fields + USD cost.
 * Estimates in tokenCounter.js are NEVER used for billing.
 */

/** @typedef {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} AnthropicUsage */

/**
 * @param {AnthropicUsage|null|undefined} usage
 * @returns {{
 *   input_tokens: number,
 *   output_tokens: number,
 *   cache_creation_input_tokens: number,
 *   cache_read_input_tokens: number,
 *   total_tokens: number,
 * }}
 */
export function normalizeAnthropicUsage(usage) {
  const input_tokens = Math.max(0, Number(usage?.input_tokens) || 0);
  const output_tokens = Math.max(0, Number(usage?.output_tokens) || 0);
  const cache_creation_input_tokens = Math.max(
    0,
    Number(usage?.cache_creation_input_tokens) || 0,
  );
  const cache_read_input_tokens = Math.max(
    0,
    Number(usage?.cache_read_input_tokens) || 0,
  );
  return {
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
    total_tokens:
      input_tokens
      + output_tokens
      + cache_creation_input_tokens
      + cache_read_input_tokens,
  };
}

/**
 * @param {ReturnType<typeof normalizeAnthropicUsage>} tokens
 * @param {{
 *   inputPerMillion: number,
 *   outputPerMillion: number,
 *   cacheWritePerMillion: number,
 *   cacheReadPerMillion: number,
 * }} rates - USD per 1M tokens
 */
export function computeUsageCostUsd(tokens, rates) {
  const perM = (count, price) => (count / 1_000_000) * price;
  const input_cost_usd = perM(tokens.input_tokens, rates.inputPerMillion);
  const output_cost_usd = perM(tokens.output_tokens, rates.outputPerMillion);
  const cache_write_cost_usd = perM(
    tokens.cache_creation_input_tokens,
    rates.cacheWritePerMillion,
  );
  const cache_read_cost_usd = perM(
    tokens.cache_read_input_tokens,
    rates.cacheReadPerMillion,
  );
  const cost_usd =
    input_cost_usd + output_cost_usd + cache_write_cost_usd + cache_read_cost_usd;
  return {
    input_cost_usd,
    output_cost_usd,
    cache_write_cost_usd,
    cache_read_cost_usd,
    cost_usd,
  };
}

/**
 * @param {AnthropicUsage|null|undefined} usage
 * @param {object} rates
 */
export function normalizeUsageWithCost(usage, rates) {
  const tokens = normalizeAnthropicUsage(usage);
  const costs = computeUsageCostUsd(tokens, rates);
  return { ...tokens, ...costs };
}
