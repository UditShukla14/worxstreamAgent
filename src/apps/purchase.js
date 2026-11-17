/**
 * Buying credit for an AI app: the server prices a plan or a custom amount (the caller never chooses the price), credits the
 * app's wallet and, for a purchase, makes sure the company is subscribed. Used by ops top-ups and by Stripe payments.
 */
import { getPlan } from './plans.js';
import { loadAppPlanContext, quoteForPrice, PricingInputError } from './pricing.js';
import { grantAppCredits } from './appWallet.js';
import { ensureSubscription } from './subscriptions.js';

/**
 * What a purchase costs and buys.
 * @param {string} app
 * @param {{ plan_id?: string, custom_amount_usd?: number|string }} purchase
 * @returns {Promise<{ title: string, plan_id: string, plan_name: string, price_usd: number, credit_usd: number, bonus_pct: number, custom: boolean }>}
 */
export async function priceAppPurchase(app, purchase = {}) {
  const ctx = await loadAppPlanContext(app);
  if (purchase.plan_id) {
    const plan = await getPlan(app, purchase.plan_id);
    if (!plan || !plan.active) throw new PricingInputError(`Plan "${purchase.plan_id}" not found`);
    const q = quoteForPrice(plan.price_usd, ctx.settings, ctx.markup);
    return { title: plan.name, plan_id: plan.plan_id, plan_name: plan.name, price_usd: q.price_usd, credit_usd: q.credit_usd, bonus_pct: q.bonus_pct, custom: false };
  }
  const amount = Number(purchase.custom_amount_usd);
  if (!Number.isFinite(amount) || amount < ctx.settings.custom_min_usd || amount > ctx.settings.custom_max_usd) {
    throw new PricingInputError(`Enter an amount between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}`);
  }
  const q = quoteForPrice(amount, ctx.settings, ctx.markup);
  return { title: 'Custom amount', plan_id: '', plan_name: 'Custom amount', price_usd: q.price_usd, credit_usd: q.credit_usd, bonus_pct: q.bonus_pct, custom: true };
}

/**
 * Credit a purchase to the company's wallet. Idempotent per `payment_ref`.
 * Plan / custom amount: priced here. `amount_usd` alone is an ops goodwill top-up (no price paid, no plan).
 * A purchase also switches the app on for the company when it has no subscription yet.
 */
export async function grantAppPurchase(companyId, app, body = {}) {
  const purchase = body.plan_id || (body.custom_amount_usd !== undefined && body.custom_amount_usd !== null && body.custom_amount_usd !== '')
    ? await priceAppPurchase(app, body)
    : null;
  const amount = purchase ? purchase.credit_usd : Number(body.amount_usd);
  const wallet = await grantAppCredits(companyId, app, {
    amount_usd: amount,
    payment_ref: body.payment_ref,
    reason: body.reason,
    actor: body.actor,
    plan_id: purchase?.plan_id,
    plan_name: purchase?.plan_name,
    paid_usd: body.paid_usd ?? purchase?.price_usd,
  });
  if (purchase && !wallet.duplicate) await ensureSubscription(companyId, app, { plan_name: purchase.plan_name });
  return wallet;
}
