/**
 * Normalize LLM response.usage into billing fields + USD cost.
 * Accepts native OpenAI Chat Completions usage fields.
 * Estimates in tokenCounter.js are NEVER used for billing.
 */

/** @typedef {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number, prompt_tokens_details?: object }} OpenAIUsage */

/**
 * @param {OpenAIUsage|null|undefined} usage
 * @returns {{
 *   input_tokens: number,
 *   output_tokens: number,
 *   cache_creation_input_tokens: number,
 *   cache_read_input_tokens: number,
 *   total_tokens: number,
 * }}
 */
export function normalizeOpenAIUsage(usage) {
  const promptTokens = Math.max(0, Number(usage?.prompt_tokens) || 0);
  const output_tokens = Math.max(0, Number(usage?.completion_tokens) || 0);
  const cache_creation_input_tokens = 0;
  const cache_read_input_tokens = Math.max(
    0,
    Number(usage?.prompt_tokens_details?.cached_tokens) || 0,
  );
  const input_tokens = Math.max(0, promptTokens - cache_read_input_tokens);
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
 * @param {ReturnType<typeof normalizeOpenAIUsage>} tokens
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
 * @param {OpenAIUsage|null|undefined} usage
 * @param {object} rates
 */
export function normalizeUsageWithCost(usage, rates) {
  const tokens = normalizeOpenAIUsage(usage);
  const costs = computeUsageCostUsd(tokens, rates);
  return { ...tokens, ...costs };
}
