/**
 * Customer billing routes, mounted at /api/agents/credits (behind requireWorxstreamAuth, so the company is the
 * logged-in one). The web app calls these instead of Laravel.
 *
 *   POST /api/agents/credits/checkout            { plan_id } | { custom_amount_usd }  ->  { clientSecret, paymentIntentId, display }
 *   GET  /api/agents/credits/payments/:id        ->  { status, credited }
 */

import { Router } from 'express';
import { resolveConversationTenantIds } from '../../utils/worxstreamCredentials.js';
import { isStripeConfigured } from './stripeClient.js';
import { createNovaPayment, getNovaPaymentStatus } from './novaCheckout.js';

const router = Router();

function tenant(req, res) {
  const { companyId, userId } = resolveConversationTenantIds(req);
  if (!companyId || !userId) {
    res.status(400).json({ success: false, error: 'companyId and userId are required' });
    return null;
  }
  return { companyId, userId };
}

function fail(res, next, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
  if (err?.type && String(err.type).startsWith('Stripe')) {
    console.error('Stripe error:', err.message);
    return res.status(502).json({ success: false, error: 'The payment service could not be reached. Please try again.' });
  }
  return next(err);
}

router.post('/checkout', async (req, res, next) => {
  const t = tenant(req, res);
  if (!t) return;
  if (!isStripeConfigured()) return res.status(503).json({ success: false, error: 'Online payment is not available yet' });
  try {
    const { plan_id, custom_amount_usd } = req.body || {};
    const data = await createNovaPayment({ ...t, purchase: { plan_id, custom_amount_usd } });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, next, err);
  }
});

router.get('/payments/:paymentIntentId', async (req, res, next) => {
  const t = tenant(req, res);
  if (!t) return;
  try {
    res.json({ success: true, data: await getNovaPaymentStatus({ companyId: t.companyId, paymentIntentId: req.params.paymentIntentId }) });
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
