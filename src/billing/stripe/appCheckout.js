/**
 * Credit purchases for the AI apps other than Nova (Raven) through Stripe. Same flow as Nova's (novaCheckout.js):
 *  1. createAppPayment: price the plan / custom amount on the server, create a PaymentIntent, return its clientSecret.
 *  2. settleAppPayment: once Stripe says the payment succeeded, credit the app's wallet (and switch the app on). Idempotent per
 *     PaymentIntent id, so the webhook and the "confirm" endpoint can both call it.
 */
import { getStripe } from './stripeClient.js';
import { priceAppPurchase, grantAppPurchase } from '../../apps/purchase.js';
import { APPS, isAppKey } from '../../apps/registry.js';
import { PricingInputError } from '../../apps/pricing.js';
import { CheckoutInputError } from './novaCheckout.js';

/** Payment kind written on the PaymentIntent, e.g. "raven_credits". */
export const appCreditsKind = (app) => `${app}_credits`;
export const isAppCreditsKind = (kind) => /^[a-z]+_credits$/.test(String(kind || '')) && isAppKey(String(kind).replace(/_credits$/, '')) && kind !== 'nova_credits';
const appOfKind = (kind) => String(kind).replace(/_credits$/, '');
const cents = (usd) => Math.round(Number(usd) * 100);

async function price(app, purchase) {
  try {
    return await priceAppPurchase(app, purchase);
  } catch (err) {
    if (err instanceof PricingInputError) throw new CheckoutInputError(err.message);
    throw err;
  }
}

export async function createAppPayment({ app, companyId, userId, purchase }) {
  if (!isAppKey(app) || app === 'nova') throw new CheckoutInputError('Unknown app');
  const priced = await price(app, purchase);
  const intent = await getStripe().paymentIntents.create({
    amount: cents(priced.price_usd),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    description: `${APPS[app].name} credit: ${priced.title}`,
    metadata: {
      kind: appCreditsKind(app),
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

/** @returns {Promise<{ credited: boolean, duplicate?: boolean, reason?: string }>} */
export async function settleAppPayment(intent) {
  const meta = intent?.metadata || {};
  if (!isAppCreditsKind(meta.kind)) return { credited: false, reason: 'not an AI app credit payment' };
  if (intent.status !== 'succeeded') return { credited: false, reason: `payment is ${intent.status}` };
  if (!meta.company_id) return { credited: false, reason: 'company_id missing on the payment' };
  const body = { payment_ref: intent.id, actor: 'stripe', paid_usd: (intent.amount_received ?? intent.amount) / 100 };
  if (meta.plan_id) body.plan_id = meta.plan_id;
  else body.custom_amount_usd = Number(meta.custom_amount_usd);
  const wallet = await grantAppPurchase(meta.company_id, appOfKind(meta.kind), body);
  return { credited: !wallet.duplicate, duplicate: Boolean(wallet.duplicate) };
}

export async function getAppPaymentStatus({ companyId, paymentIntentId }) {
  const intent = await getStripe().paymentIntents.retrieve(String(paymentIntentId));
  if (!isAppCreditsKind(intent.metadata?.kind) || intent.metadata?.company_id !== String(companyId)) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }
  const settled = intent.status === 'succeeded' ? await settleAppPayment(intent) : { credited: false };
  return { status: intent.status, credited: intent.status === 'succeeded' && (settled.credited || Boolean(settled.duplicate)) };
}
