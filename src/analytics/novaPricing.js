/**
 * Nova pricing: volume discounts, quotes for any amount, and what an amount buys.
 *
 * The company pays `price_usd`. Every request later debits its credit by Anthropic's cost x (1 + markup) (the base margin,
 * `NOVA_MARKUP_RATE`, default 20%). A larger purchase earns a lower margin (15-20% by default) and the difference is given
 * back as BONUS CREDIT: the company still pays `price_usd` but receives slightly more credit:
 *
 *     credit = price x (1 + markup) / (1 + margin_for_that_amount)
 *
 * so a company only ever sees what it pays and what it receives, never Anthropic's cost.
 */

import NovaSetting from './models/NovaSetting.js';
import { config } from '../config/index.js';

export const DEFAULT_PRICING = Object.freeze({
  /** Margin on Anthropic's price by purchase size. Must start at 0 and never go up as the amount grows. */
  tiers: [
    { min_usd: 0, margin_rate: 0.2 },
    { min_usd: 250, margin_rate: 0.18 },
    { min_usd: 1000, margin_rate: 0.15 },
  ],
  /** The "type your own amount" plan. */
  custom_min_usd: 20,
  custom_max_usd: 10000,
  /** Average credit one chat request uses, to tell a company roughly what an amount buys. */
  typical_request_usd: 0.15,
});

/** Staff or caller input that is not acceptable; routes answer 400 for it. */
export class PricingInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PricingInputError';
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Validate and normalise pricing settings from staff input.
 * @param {any} input
 */
export function sanitizePricing(input = {}) {
  const base = DEFAULT_PRICING;
  const tiersIn = input.tiers !== undefined ? input.tiers : base.tiers;
  if (!Array.isArray(tiersIn) || tiersIn.length === 0) throw new PricingInputError('tiers must be a non-empty list');
  const tiers = tiersIn
    .map((t) => ({ min_usd: Number(t?.min_usd), margin_rate: Number(t?.margin_rate) }))
    .sort((a, b) => a.min_usd - b.min_usd);
  for (const t of tiers) {
    if (!Number.isFinite(t.min_usd) || t.min_usd < 0) throw new PricingInputError('tier min_usd must be zero or more');
    if (!Number.isFinite(t.margin_rate) || t.margin_rate < 0 || t.margin_rate > 1) throw new PricingInputError('tier margin_rate must be between 0 and 1 (0.2 = 20%)');
  }
  if (tiers[0].min_usd !== 0) throw new PricingInputError('the first tier must start at 0');
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].min_usd === tiers[i - 1].min_usd) throw new PricingInputError('tiers must have different amounts');
    if (tiers[i].margin_rate > tiers[i - 1].margin_rate) throw new PricingInputError('a larger purchase cannot have a higher margin than a smaller one');
  }

  const min = input.custom_min_usd !== undefined ? Number(input.custom_min_usd) : base.custom_min_usd;
  const max = input.custom_max_usd !== undefined ? Number(input.custom_max_usd) : base.custom_max_usd;
  if (!Number.isFinite(min) || min <= 0) throw new PricingInputError('custom_min_usd must be a positive number');
  if (!Number.isFinite(max) || max <= min) throw new PricingInputError('custom_max_usd must be larger than custom_min_usd');
  const typical = input.typical_request_usd !== undefined ? Number(input.typical_request_usd) : base.typical_request_usd;
  if (!Number.isFinite(typical) || typical <= 0) throw new PricingInputError('typical_request_usd must be a positive number');

  return { tiers, custom_min_usd: min, custom_max_usd: max, typical_request_usd: typical };
}

export async function getPricingSettings() {
  const doc = await NovaSetting.findOne({ key: 'pricing' }).lean();
  if (!doc?.value) return { ...DEFAULT_PRICING, tiers: DEFAULT_PRICING.tiers.map((t) => ({ ...t })) };
  try {
    return sanitizePricing(doc.value);
  } catch {
    return { ...DEFAULT_PRICING, tiers: DEFAULT_PRICING.tiers.map((t) => ({ ...t })) };
  }
}

export async function savePricingSettings(input) {
  const value = sanitizePricing(input);
  await NovaSetting.findOneAndUpdate(
    { key: 'pricing' },
    { $set: { value, updated_at: new Date() }, $setOnInsert: { key: 'pricing' } },
    { upsert: true },
  );
  return value;
}

/** The margin that applies to a purchase of this size: the last tier whose threshold the amount reaches. */
export function marginForAmount(amountUsd, tiers) {
  let margin = tiers[0].margin_rate;
  for (const t of tiers) if (amountUsd >= t.min_usd) margin = t.margin_rate;
  return margin;
}

/**
 * What an amount costs and buys.
 * @param {number} priceUsd what the company pays
 * @param {{ tiers: any[], typical_request_usd: number }} settings
 * @param {number} [markup] debit markup in effect (default NOVA_MARKUP_RATE)
 */
export function quoteForPrice(priceUsd, settings, markup = config.billing?.markupRate ?? 0) {
  const price = round2(Number(priceUsd));
  if (!Number.isFinite(price) || price <= 0) throw new PricingInputError('amount must be a positive number');
  const k = Math.max(0, Number(markup) || 0);
  // A margin above the debit markup cannot be earned, so it is capped there (and then there is no bonus).
  const margin = Math.min(marginForAmount(price, settings.tiers), k);
  const credit = round2((price * (1 + k)) / (1 + margin));
  const bonusPct = price > 0 ? Math.round((credit / price - 1) * 1000) / 10 : 0;
  const value = round2(credit / (1 + k)); // Anthropic usage the credit covers
  return {
    price_usd: price,
    credit_usd: credit,
    bonus_pct: bonusPct > 0 ? bonusPct : 0,
    estimated_requests: Math.max(0, Math.round(credit / settings.typical_request_usd / 10) * 10),
    // staff only:
    margin_rate: margin,
    anthropic_value_usd: value,
    margin_usd: round2(price - value),
  };
}

/** What a company is allowed to see of a quote. */
export function toCustomerQuote(q) {
  return { price_usd: q.price_usd, credit_usd: q.credit_usd, bonus_pct: q.bonus_pct, estimated_requests: q.estimated_requests };
}

/** For the custom-amount card: the amounts at which a bigger bonus starts. */
export function bonusTiers(settings, markup = config.billing?.markupRate ?? 0) {
  const out = [];
  for (const t of settings.tiers) {
    if (t.min_usd <= 0) continue;
    const q = quoteForPrice(t.min_usd, settings, markup);
    if (q.bonus_pct > 0) out.push({ min_usd: t.min_usd, bonus_pct: q.bonus_pct });
  }
  return out;
}
