/**
 * POST /api/webhooks/stripe — Stripe calls this when a payment succeeds. The signature is verified against the RAW
 * request body (captured in app.js for paths under /api/webhooks), so the body must not be re-serialised.
 */

import { Router } from 'express';
import { config } from '../../config/index.js';
import { getStripe } from './stripeClient.js';
import { settleNovaPayment } from './novaCheckout.js';
import { settleAppPayment } from './appCheckout.js';
import { handleDisputeCreated, handleDisputeClosed } from './disputes.js';

const router = Router();

router.post('/', async (req, res) => {
  const secret = config.stripe.webhookSecret;
  if (!secret || !config.stripe.secretKey) {
    return res.status(503).json({ success: false, error: 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET)' });
  }
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).json({ success: false, error: `Invalid signature: ${err.message}` });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const result = (await settleNovaPayment(intent)).credited ? { credited: true, app: 'Nova' } : { ...(await settleAppPayment(intent)), app: 'AI app' };
      if (result.credited) console.log(`💳 ${result.app} credit granted for ${intent.id}`);
    }
    if (event.type === 'charge.dispute.created') {
      const r = await handleDisputeCreated(event.data.object);
      if (r.handled) console.warn(`⚠️  Chargeback ${event.data.object.id}: Nova credit taken back`);
    }
    if (event.type === 'charge.dispute.closed') {
      const r = await handleDisputeClosed(event.data.object);
      if (r.handled) console.log(`✅ Dispute ${event.data.object.id} closed (${event.data.object.status}): Nova credit restored`);
    }
    // Any other event is acknowledged so Stripe does not retry it.
    return res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook failed:', err?.message || err);
    // 500 makes Stripe retry; crediting is idempotent so a retry is safe.
    return res.status(500).json({ success: false, error: 'Could not process the event' });
  }
});

export default router;
