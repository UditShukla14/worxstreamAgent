/**
 * Customer billing routes, mounted at /api/agents/credits (behind requireWorxstreamAuth, so the company is the
 * logged-in one). The web app calls these instead of Laravel.
 *
 *   POST /api/agents/credits/checkout            { plan_id } | { custom_amount_usd }  ->  { clientSecret, paymentIntentId, display }
 *   GET  /api/agents/credits/payments/:id        ->  { status, credited }
 *   GET  /api/agents/credits/invoices/:id        ->  printable HTML invoice for one purchase (id = wallet history row id)
 */

import { Router } from 'express';
import { resolveConversationTenantIds } from '../../utils/worxstreamCredentials.js';
import { isStripeConfigured } from './stripeClient.js';
import { createNovaPayment, getNovaPaymentStatus } from './novaCheckout.js';
import { createAppPayment, getAppPaymentStatus, isAppCreditsKind } from './appCheckout.js';
import { isAppKey } from '../../apps/registry.js';
import mongoose from 'mongoose';
import { config } from '../../config/index.js';
import WalletTransaction from '../../analytics/models/WalletTransaction.js';
import { getWallet } from '../../analytics/novaWallet.js';
import { isInvoiceable, renderInvoiceHtml } from '../invoice.js';

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
    const { plan_id, custom_amount_usd, app } = req.body || {};
    // `app` picks whose wallet is credited: omitted or "nova" = Nova (as before), "raven" = Raven.
    if (app && app !== 'nova' && !isAppKey(app)) return res.status(400).json({ success: false, error: 'Unknown app' });
    const data = app && app !== 'nova'
      ? await createAppPayment({ app, ...t, purchase: { plan_id, custom_amount_usd } })
      : await createNovaPayment({ ...t, purchase: { plan_id, custom_amount_usd } });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, next, err);
  }
});

router.get('/payments/:paymentIntentId', async (req, res, next) => {
  const t = tenant(req, res);
  if (!t) return;
  try {
    // Look at the payment first to know whose credit it is, then settle it through the matching flow.
    const { getStripe } = await import('./stripeClient.js');
    const intent = await getStripe().paymentIntents.retrieve(String(req.params.paymentIntentId));
    const status = isAppCreditsKind(intent.metadata?.kind) ? getAppPaymentStatus : getNovaPaymentStatus;
    res.json({ success: true, data: await status({ companyId: t.companyId, paymentIntentId: req.params.paymentIntentId }) });
  } catch (err) {
    fail(res, next, err);
  }
});

router.get('/invoices/:id', async (req, res, next) => {
  const t = tenant(req, res);
  if (!t) return;
  try {
    const row = mongoose.isValidObjectId(req.params.id) ? await WalletTransaction.findById(req.params.id).lean() : null;
    // Another company's row looks the same as a missing one.
    if (!row || row.company_id !== String(t.companyId)) return res.status(404).json({ success: false, error: 'Invoice not found' });
    const tx = {
      id: String(row._id),
      type: row.type,
      created_at: row.created_at,
      plan_name: row.plan_name || '',
      paid_usd: row.paid_micros == null ? null : row.paid_micros / 1e6,
      amount_usd: row.amount_usd,
      payment_ref: row.payment_ref || '',
    };
    if (!isInvoiceable(tx)) return res.status(404).json({ success: false, error: 'No invoice for this entry' });
    const wallet = await getWallet(t.companyId);
    const inv = config.invoice;
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'private, no-store').send(
      renderInvoiceHtml(tx, { company_id: t.companyId, company_name: wallet?.display_name || '' }, { name: inv.sellerName, address: inv.sellerAddress, tax_id: inv.sellerTaxId }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
