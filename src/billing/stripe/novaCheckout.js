/**
 * Nova credit purchases through Stripe.
 *
 *  1. createNovaPayment: price the plan / custom amount on the server, create a PaymentIntent, return its clientSecret
 *     (the web app confirms it with Stripe Elements). The browser never chooses the price.
 *  2. settleNovaPayment: once Stripe says the payment succeeded, credit the wallet. Idempotent per PaymentIntent id
 *     (grantWalletCredits ignores a repeated payment_ref), so the webhook and the "confirm" endpoint can both call it.
 */

import { getStripe } from './stripeClient.js';
import { getNovaPlan, loadPlanContext } from '../../analytics/novaPlans.js';
import { quoteForPrice } from '../../analytics/novaPricing.js';
import { grantWalletCredits } from '../../analytics/novaWallet.js';

export const NOVA_CREDITS_KIND = 'nova_credits';

const cents = (usd) => Math.round(Number(usd) * 100);

export class CheckoutInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutInputError';
    this.statusCode = 400;
  }
}

/**
 * What the company is buying, priced by the server.
 * @param {{ plan_id?: string, custom_amount_usd?: number|string }} purchase
 * @returns {Promise<{ title: string, plan_id: string, price_usd: number, credit_usd: number, bonus_pct: number }>}
 */
export async function priceNovaPurchase(purchase = {}) {
  const ctx = await loadPlanContext();
  if (purchase.plan_id) {
    const plan = await getNovaPlan(purchase.plan_id);
    if (!plan) throw new CheckoutInputError(`Plan "${purchase.plan_id}" not found`);
    const q = quoteForPrice(plan.price_usd, ctx.settings, ctx.markup);
    return { title: plan.name, plan_id: plan.plan_id, price_usd: q.price_usd, credit_usd: q.credit_usd, bonus_pct: q.bonus_pct };
  }
  const amount = Number(purchase.custom_amount_usd);
  if (!Number.isFinite(amount) || amount < ctx.settings.custom_min_usd || amount > ctx.settings.custom_max_usd) {
    throw new CheckoutInputError(`Enter an amount between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}`);
  }
  const q = quoteForPrice(amount, ctx.settings, ctx.markup);
  return { title: 'Custom amount', plan_id: '', price_usd: q.price_usd, credit_usd: q.credit_usd, bonus_pct: q.bonus_pct };
}

/**
 * Create the Stripe PaymentIntent for a purchase.
 * @param {{ companyId: string, userId: string, purchase: { plan_id?: string, custom_amount_usd?: number|string } }} args
 */
export async function createNovaPayment({ companyId, userId, purchase }) {
  const priced = await priceNovaPurchase(purchase);
  const intent = await getStripe().paymentIntents.create({
    amount: cents(priced.price_usd),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    description: `Nova credit: ${priced.title}`,
    metadata: {
      kind: NOVA_CREDITS_KIND,
      company_id: String(companyId),
      user_id: String(userId || ''),
      plan_id: priced.plan_id,
      custom_amount_usd: priced.plan_id ? '' : String(priced.price_usd),
    },
  });
  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    display: { amountFormatted: priced.price_usd.toFixed(2), currency: 'USD' },
    credit_usd: priced.credit_usd,
    bonus_pct: priced.bonus_pct,
  };
}

/**
 * Credit the wallet for a succeeded Nova PaymentIntent. Safe to call any number of times for the same intent.
 * @param {import('stripe').Stripe.PaymentIntent} intent
 * @returns {Promise<{ credited: boolean, duplicate?: boolean, reason?: string }>}
 */
export async function settleNovaPayment(intent) {
  const meta = intent?.metadata || {};
  if (meta.kind !== NOVA_CREDITS_KIND) return { credited: false, reason: 'not a Nova credit payment' };
  if (intent.status !== 'succeeded') return { credited: false, reason: `payment is ${intent.status}` };
  if (!meta.company_id) return { credited: false, reason: 'company_id missing on the payment' };

  const body = { payment_ref: intent.id, actor: 'stripe', paid_usd: (intent.amount_received ?? intent.amount) / 100 };
  if (meta.plan_id) body.plan_id = meta.plan_id;
  else body.custom_amount_usd = Number(meta.custom_amount_usd);
  const wallet = await grantWalletCredits(meta.company_id, body);
  return { credited: !wallet.duplicate, duplicate: Boolean(wallet.duplicate) };
}

/**
 * Where a payment stands, for the company that started it (the web app calls this after confirming the card, so the
 * credit shows without waiting for the webhook). Credits the wallet itself if Stripe already succeeded.
 */
export async function getNovaPaymentStatus({ companyId, paymentIntentId }) {
  const intent = await getStripe().paymentIntents.retrieve(String(paymentIntentId));
  if (intent.metadata?.kind !== NOVA_CREDITS_KIND || intent.metadata?.company_id !== String(companyId)) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }
  const settled = intent.status === 'succeeded' ? await settleNovaPayment(intent) : { credited: false };
  return { status: intent.status, credited: intent.status === 'succeeded' && (settled.credited || Boolean(settled.duplicate)) };
}
