/**
 * Cost computation — the ONE place that turns Anthropic `usage` into money.
 *
 * Standard pattern:
 *  - the ledger stores tokens + the exact rates used + PROVIDER cost (what Anthropic charges us),
 *    as integer micro-USD (1 USD = 1_000_000 micros; a price of $X per million tokens is exactly
 *    X micro-USD per token, so no float drift accumulates);
 *  - the BILLABLE amount (provider cost x (1 + markup)) is computed once per event, with the markup
 *    rate in effect stored on the row, so later rate changes never rewrite history;
 *  - rounding happens once per event (to a micro-USD), never to cents per turn.
 */

import { normalizeAnthropicUsage, computeUsageCostUsd } from './usageNormalize.js';
import { resolveModelRatesDetailed } from './modelPricing.js';
import { config } from '../config/index.js';

export const MICROS_PER_USD = 1_000_000;

export const usdToMicros = (usd) => Math.round((Number(usd) || 0) * MICROS_PER_USD);
export const microsToUsd = (micros) => (Number(micros) || 0) / MICROS_PER_USD;

export function clampMarkup(rate) {
  const n = Number(rate);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

/**
 * @param {object} p
 * @param {string} p.model            requested model id
 * @param {string} [p.responseModel]  model the API says served the call (preferred for pricing)
 * @param {object} p.usage            Anthropic response.usage
 * @param {number} [p.markupRate]     default config.billing.markupRate
 */
export function computeEventCost({ model, responseModel = '', usage, markupRate }) {
  const tokens = normalizeAnthropicUsage(usage);
  const inputHint = tokens.input_tokens + tokens.cache_creation_input_tokens + tokens.cache_read_input_tokens;
  const priced = resolveModelRatesDetailed(String(responseModel || model || ''), { inputTokens: inputHint });
  const usd = computeUsageCostUsd(tokens, priced.rates);

  // tokens x ($/M) = micro-USD exactly; sum fractional parts, round once.
  const providerMicros = Math.round(
    tokens.input_tokens * priced.rates.inputPerMillion
    + tokens.output_tokens * priced.rates.outputPerMillion
    + tokens.cache_creation_input_tokens * priced.rates.cacheWritePerMillion
    + tokens.cache_read_input_tokens * priced.rates.cacheReadPerMillion,
  );
  const rate = clampMarkup(markupRate ?? config.billing?.markupRate ?? 0);
  const billableMicros = Math.round(providerMicros * (1 + rate));

  return {
    tokens,
    components_usd: usd,
    rates: priced.rates,
    estimated: priced.estimated,
    reason: priced.reason,
    catalogId: priced.catalogId,
    pricingVersion: priced.pricingVersion,
    markupRate: rate,
    providerMicros,
    billableMicros,
    providerCostUsd: microsToUsd(providerMicros),
    billableUsd: microsToUsd(billableMicros),
  };
}
