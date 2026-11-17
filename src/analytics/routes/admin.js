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
import { listNovaPlans, getNovaPlan, saveNovaPlan, toAdminPlan, loadPlanContext } from '../novaPlans.js';
import { getPricingSettings, savePricingSettings, quoteForPrice } from '../novaPricing.js';
import { listCompanyModelAssignments } from '../customerModels.js';
import { config } from '../../config/index.js';
import { getAppsOverview } from '../../apps/overview.js';
import { getCompanyApps, setSubscription, assertApp, AppInputError } from '../../apps/subscriptions.js';
import { setAppAllowance, getAppWalletView, listAppTransactions } from '../../apps/appWallet.js';
import { grantAppPurchase } from '../../apps/purchase.js';
import { listPlans as listAppPlans, savePlan as saveAppPlan, toAdminPlan as toAdminAppPlan } from '../../apps/plans.js';
import { getAppPricing, saveAppPricing, loadAppPlanContext, quoteForPrice as quoteAppPrice, PricingInputError as AppPricingError } from '../../apps/pricing.js';

const router = Router();
router.use(requireAdminAuth);

// ---- Ops dashboard endpoints -------------------------------------------------

router.get('/analytics/summary', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getSummary({ from: req.query.from, to: req.query.to, app: req.query.app }) });
  } catch (err) { next(err); }
});

router.get('/analytics/usage', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getUsage(req.query) });
  } catch (err) { next(err); }
});

router.get('/analytics/directory', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getDirectory({ from: req.query.from, to: req.query.to, app: req.query.app }) });
  } catch (err) { next(err); }
});

router.get('/analytics/companies/:companyId/detail', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getCompanyDetail(req.params.companyId, { from: req.query.from, to: req.query.to, app: req.query.app }) });
  } catch (err) { next(err); }
});

router.get('/analytics/wallets', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getWalletsInsights({ app: req.query.app }) });
  } catch (err) { next(err); }
});

const insight = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn({ from: req.query.from, to: req.query.to, app: req.query.app }) });
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
    if (/amount_usd|companyId|plan "|custom_amount_usd/.test(err?.message || '')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ---- Nova credit plans (what companies can buy) ----------------------------------
/** All plans with price, the credit it buys, bonus, what it covers in Anthropic usage and the margin, plus the pricing rules. */
router.get('/analytics/nova-plans', async (req, res, next) => {
  try {
    const ctx = await loadPlanContext();
    const plans = (await listNovaPlans()).map((p) => toAdminPlan(p, ctx));
    res.json({ success: true, data: { plans, pricing: ctx.settings, usage_markup_rate: ctx.markup } });
  } catch (err) {
    next(err);
  }
});

/** Price any amount (Laravel uses this to price a custom-amount payment on the server): ?amount=300 */
router.get('/analytics/nova-plans/quote', async (req, res, next) => {
  try {
    const ctx = await loadPlanContext();
    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount < ctx.settings.custom_min_usd || amount > ctx.settings.custom_max_usd) {
      return res.status(400).json({ success: false, error: `amount must be between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}` });
    }
    res.json({ success: true, data: quoteForPrice(amount, ctx.settings, ctx.markup) });
  } catch (err) {
    next(err);
  }
});

/** One plan (Laravel uses this to price a payment on the server). */
router.get('/analytics/nova-plans/:planId', async (req, res, next) => {
  try {
    const plan = await getNovaPlan(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    res.json({ success: true, data: toAdminPlan(plan, await loadPlanContext()) });
  } catch (err) {
    next(err);
  }
});

/** Every company with its plan, credit and the model it uses for each kind of task (the Subscriptions tab). */
router.get('/analytics/company-models', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listCompanyModelAssignments() });
  } catch (err) {
    next(err);
  }
});

/** Volume-discount tiers, custom-amount limits and the typical cost of a request. */
router.get('/analytics/nova-pricing', async (req, res, next) => {
  try {
    res.json({ success: true, data: { pricing: await getPricingSettings(), usage_markup_rate: config.billing?.markupRate ?? 0 } });
  } catch (err) {
    next(err);
  }
});

router.put('/analytics/nova-pricing', async (req, res, next) => {
  try {
    res.json({ success: true, data: { pricing: await savePricingSettings(req.body || {}), usage_markup_rate: config.billing?.markupRate ?? 0 } });
  } catch (err) {
    if (err?.name === 'PricingInputError') return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
});

const PLAN_INPUT_ERRORS = /plan_id|name is required|price_usd|already exists|not found/;

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

// ---- AI apps hub (Nova + Raven): subscriptions and per-app wallets ------------------------------------------------

const appInput = (res, next, err) => (err instanceof AppInputError || /must be|required/.test(err?.message || '')
  ? res.status(400).json({ success: false, error: err.message })
  : next(err));

router.get('/analytics/apps', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getAppsOverview({ from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
});

router.get('/analytics/companies/:companyId/apps', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getCompanyApps(req.params.companyId) });
  } catch (err) { next(err); }
});

/** Subscribe / pause / switch off an app, and label its plan. */
router.put('/analytics/companies/:companyId/apps/:app', async (req, res, next) => {
  try {
    const app = assertApp(req.params.app);
    await setSubscription(req.params.companyId, app, req.body || {});
    res.json({ success: true, data: await getCompanyApps(req.params.companyId) });
  } catch (err) { appInput(res, next, err); }
});

/** Raven wallet: free allowance and markup (Nova's wallet keeps its own endpoints under /wallet). */
router.put('/analytics/companies/:companyId/apps/:app/wallet', async (req, res, next) => {
  try {
    const app = assertApp(req.params.app);
    if (app !== 'raven') throw new AppInputError('Nova\'s wallet is managed under /wallet');
    res.json({ success: true, data: await setAppAllowance(req.params.companyId, app, req.body || {}) });
  } catch (err) { appInput(res, next, err); }
});

router.post('/analytics/companies/:companyId/apps/:app/credits', async (req, res, next) => {
  try {
    const app = assertApp(req.params.app);
    if (app !== 'raven') throw new AppInputError('Nova credits are granted under /wallet/credits');
    // A plan or custom amount is priced here (credit, bonus, plan name); a bare amount_usd is a goodwill top-up.
    res.json({ success: true, data: await grantAppPurchase(req.params.companyId, app, req.body || {}) });
  } catch (err) { appInput(res, next, err); }
});

router.get('/analytics/companies/:companyId/apps/:app/wallet', async (req, res, next) => {
  try {
    const app = assertApp(req.params.app);
    if (app !== 'raven') throw new AppInputError('Nova\'s wallet is read under /wallet');
    res.json({ success: true, data: await getAppWalletView(req.params.companyId, app) });
  } catch (err) { appInput(res, next, err); }
});

router.get('/analytics/companies/:companyId/apps/:app/wallet/transactions', async (req, res, next) => {
  try {
    const app = assertApp(req.params.app);
    if (app !== 'raven') throw new AppInputError('Nova\'s history is read under /wallet/transactions');
    res.json({ success: true, data: await listAppTransactions(req.params.companyId, app, { limit: req.query.limit, before: req.query.before }) });
  } catch (err) { appInput(res, next, err); }
});

// ---- Credit plans and pricing of an AI app (Raven). Nova's stay under /nova-plans and /nova-pricing. ----

const planApp = (req) => {
  const app = assertApp(req.params.app);
  if (app === 'nova') throw new AppInputError('Nova plans are managed under /nova-plans');
  return app;
};
const PLAN_ERRORS = /plan_id|name is required|price_usd|already exists|not found/;
const planInput = (res, next, err) => (err instanceof AppInputError || err instanceof AppPricingError || PLAN_ERRORS.test(err?.message || '')
  ? res.status(400).json({ success: false, error: err.message })
  : next(err));

router.get('/analytics/apps/:app/plans', async (req, res, next) => {
  try {
    const app = planApp(req);
    const ctx = await loadAppPlanContext(app);
    res.json({ success: true, data: { plans: (await listAppPlans(app)).map((p) => toAdminAppPlan(p, ctx)), pricing: ctx.settings, usage_markup_rate: ctx.markup } });
  } catch (err) { planInput(res, next, err); }
});

router.get('/analytics/apps/:app/plans/quote', async (req, res, next) => {
  try {
    const app = planApp(req);
    const ctx = await loadAppPlanContext(app);
    res.json({ success: true, data: quoteAppPrice(Number(req.query.amount), ctx.settings, ctx.markup) });
  } catch (err) { planInput(res, next, err); }
});

router.post('/analytics/apps/:app/plans', async (req, res, next) => {
  try {
    res.json({ success: true, data: await saveAppPlan(planApp(req), req.body || {}, { create: true }) });
  } catch (err) { planInput(res, next, err); }
});

router.put('/analytics/apps/:app/plans/:planId', async (req, res, next) => {
  try {
    const app = planApp(req);
    res.json({ success: true, data: await saveAppPlan(app, { ...(req.body || {}), plan_id: req.params.planId }) });
  } catch (err) { planInput(res, next, err); }
});

router.get('/analytics/apps/:app/pricing', async (req, res, next) => {
  try {
    const app = planApp(req);
    res.json({ success: true, data: { pricing: await getAppPricing(app), usage_markup_rate: (await loadAppPlanContext(app)).markup } });
  } catch (err) { planInput(res, next, err); }
});

router.put('/analytics/apps/:app/pricing', async (req, res, next) => {
  try {
    const app = planApp(req);
    const pricing = await saveAppPricing(app, req.body || {});
    res.json({ success: true, data: { pricing, usage_markup_rate: (await loadAppPlanContext(app)).markup } });
  } catch (err) { planInput(res, next, err); }
});

export default router;
