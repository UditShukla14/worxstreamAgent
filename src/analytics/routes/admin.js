/**
 * Platform admin analytics routes — token usage billing + Nova wallet.
 */

import { Router } from 'express';
import { requireAdminAuth } from '../../middleware/requireAdminAuth.js';
import {
  getOverview,
  listCompanies,
  getCompanyUsage,
  getUserUsage,
} from '../queries.js';
import {
  getWalletStatus,
  setWalletAllowance,
  grantWalletCredits,
  listWalletTransactions,
  reconcileWalletFromLedger,
  listWallets,
} from '../novaWallet.js';
import { getSummary, getUsage, getDirectory, getCompanyDetail } from '../adminQueries.js';
import { getEconomics, getGrowth, getQuality, getWalletsInsights, getModelsOverview } from '../adminInsights.js';
import { reconcileWithAnthropic } from '../anthropicReconcile.js';
import { listNovaPlans, getNovaPlan, saveNovaPlan, toAdminPlan } from '../novaPlans.js';
import { config } from '../../config/index.js';

const router = Router();
router.use(requireAdminAuth);

// ---- Ops dashboard endpoints -------------------------------------------------

router.get('/analytics/summary', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getSummary({ from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
});

router.get('/analytics/usage', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getUsage(req.query) });
  } catch (err) { next(err); }
});

router.get('/analytics/directory', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getDirectory({ from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
});

router.get('/analytics/companies/:companyId/detail', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getCompanyDetail(req.params.companyId, { from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
});

router.get('/analytics/wallets', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getWalletsInsights() });
  } catch (err) { next(err); }
});

const insight = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn({ from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
};
router.get('/analytics/economics', insight(getEconomics));
router.get('/analytics/growth', insight(getGrowth));
router.get('/analytics/quality', insight(getQuality));
router.get('/analytics/models', insight(getModelsOverview));

/** Ledger vs Anthropic's Usage & Cost Admin API (needs ANTHROPIC_ADMIN_API_KEY). */
router.get('/analytics/reconcile/anthropic', async (req, res, next) => {
  try {
    res.json({ success: true, data: await reconcileWithAnthropic({ from: req.query.from, to: req.query.to }) });
  } catch (err) {
    if (/^Anthropic |Range too large/.test(err?.message || '')) {
      return res.status(502).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.get('/analytics/overview', async (req, res, next) => {
  try {
    const data = await getOverview({
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/companies', async (req, res, next) => {
  try {
    const data = await listCompanies({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/companies/:companyId', async (req, res, next) => {
  try {
    const data = await getCompanyUsage(req.params.companyId, {
      from: req.query.from,
      to: req.query.to,
      groupBy: req.query.group_by,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/companies/:companyId/users/:userId', async (req, res, next) => {
  try {
    const data = await getUserUsage(req.params.companyId, req.params.userId, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/companies/:companyId/wallet', async (req, res, next) => {
  try {
    const data = await getWalletStatus(req.params.companyId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.put('/analytics/companies/:companyId/wallet', async (req, res, next) => {
  try {
    const data = await setWalletAllowance(req.params.companyId, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    if (/free_allowance_usd|markup_rate|display_name|plan_name|seats|companyId|Provide /.test(err?.message || '')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/** Ledger-vs-wallet drift check. POST with { apply: true } rewrites spent_usd to the ledger total. */
router.get('/analytics/companies/:companyId/wallet/reconcile', async (req, res, next) => {
  try {
    const data = await reconcileWalletFromLedger(req.params.companyId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post('/analytics/companies/:companyId/wallet/reconcile', async (req, res, next) => {
  try {
    const data = await reconcileWalletFromLedger(req.params.companyId, { apply: req.body?.apply === true });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/companies/:companyId/wallet/transactions', async (req, res, next) => {
  try {
    const data = await listWalletTransactions(req.params.companyId, { limit: req.query.limit, before: req.query.before });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** Credit a wallet. A repeated payment_ref (for example a Stripe webhook retry) never credits twice. */
router.post('/analytics/companies/:companyId/wallet/credits', async (req, res, next) => {
  try {
    const data = await grantWalletCredits(req.params.companyId, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    if (err?.message?.includes('amount_usd') || err?.message?.includes('companyId') || /plan "/.test(err?.message || '')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ---- Nova credit plans (what companies can buy) ----------------------------------
/** All plans, with the margin. `usage_markup_rate` is a warning signal: plans already carry the margin, so it should be 0. */
router.get('/analytics/nova-plans', async (req, res, next) => {
  try {
    const plans = (await listNovaPlans()).map(toAdminPlan);
    res.json({
      success: true,
      data: {
        plans,
        default_margin_rate: config.billing?.planMarginRate ?? 0.2,
        usage_markup_rate: config.billing?.markupRate ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** One plan (Laravel uses this to price a payment on the server). */
router.get('/analytics/nova-plans/:planId', async (req, res, next) => {
  try {
    const plan = await getNovaPlan(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    res.json({ success: true, data: toAdminPlan(plan) });
  } catch (err) {
    next(err);
  }
});

const PLAN_INPUT_ERRORS = /plan_id|name is required|credit_usd|margin_rate|already exists|not found/;

router.post('/analytics/nova-plans', async (req, res, next) => {
  try {
    res.json({ success: true, data: await saveNovaPlan(req.body || {}, { create: true }) });
  } catch (err) {
    if (PLAN_INPUT_ERRORS.test(err?.message || '')) return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
});

router.put('/analytics/nova-plans/:planId', async (req, res, next) => {
  try {
    res.json({ success: true, data: await saveNovaPlan({ ...(req.body || {}), plan_id: req.params.planId }) });
  } catch (err) {
    if (PLAN_INPUT_ERRORS.test(err?.message || '')) return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
});

export default router;
