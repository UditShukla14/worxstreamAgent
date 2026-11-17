/**
 * Pricing of an AI app's credit: volume discounts, quotes for any amount, what an amount buys. Same rules as Nova's
 * (analytics/novaPricing.js, reused here for the maths and the validation): the company pays `price_usd`, a larger purchase earns
 * a lower margin, and the difference comes back as bonus credit. Settings are stored per app (Nova's stay where they were).
 */
import NovaSetting from '../analytics/models/NovaSetting.js';
import { sanitizePricing, quoteForPrice, toCustomerQuote, bonusTiers, PricingInputError } from '../analytics/novaPricing.js';
import { defaultMarkup } from './appWallet.js';

export { quoteForPrice, toCustomerQuote, bonusTiers, PricingInputError };

/** Raven sells small amounts: a typical analysis (one mail) costs well under a cent. */
export const DEFAULT_APP_PRICING = Object.freeze({
  raven: {
    tiers: [
      { min_usd: 0, margin_rate: 0.2 },
      { min_usd: 100, margin_rate: 0.18 },
      { min_usd: 500, margin_rate: 0.15 },
    ],
    custom_min_usd: 5,
    custom_max_usd: 2000,
    /** Billable credit one mail analysis uses on average; "estimated_requests" is mails. */
    typical_request_usd: 0.004,
  },
});

const settingKey = (app) => `pricing:${app}`;
const defaults = (app) => ({ ...DEFAULT_APP_PRICING[app], tiers: DEFAULT_APP_PRICING[app].tiers.map((t) => ({ ...t })) });

export async function getAppPricing(app) {
  const doc = await NovaSetting.findOne({ key: settingKey(app) }).lean();
  if (!doc?.value) return defaults(app);
  try {
    return sanitizePricing({ ...defaults(app), ...doc.value });
  } catch {
    return defaults(app);
  }
}

export async function saveAppPricing(app, input) {
  const value = sanitizePricing({ ...defaults(app), ...input });
  await NovaSetting.findOneAndUpdate({ key: settingKey(app) }, { $set: { value, updated_at: new Date() }, $setOnInsert: { key: settingKey(app) } }, { upsert: true });
  return value;
}

/** Settings and markup of an app together, so a view is built from one consistent snapshot. */
export async function loadAppPlanContext(app) {
  return { settings: await getAppPricing(app), markup: defaultMarkup(app) };
}
