/**
 * Customer endpoints for an AI app's wallet and credit plans, mounted at /api/agents/apps (same per-request credentials as chat:
 * companyId, userId, apiToken). Only Raven today; Nova keeps its own /api/agents/wallet and /api/agents/plans.
 *
 *   GET  /:app/wallet                  the company's wallet (no markup, no staff notes)
 *   GET  /:app/wallet/transactions     credit history
 *   GET  /:app/usage?from=&to=         mails analysed and what they cost the company, per day (default: last 30 days), with the per-employee division; ?mine=1 = only my own usage
 *   GET  /:app/plans                   plans on sale + the custom-amount range and bonus steps
 *   GET  /:app/plans/quote?amount=     what a custom amount costs and buys
 *   GET  /:app/status                  is the app active for the company (subscription + credit)
 * Buying credit is POST /api/agents/credits/checkout with { app, plan_id | custom_amount_usd }.
 */
import { Router } from 'express';
import { resolveConversationTenantIds } from '../../utils/worxstreamCredentials.js';
import { isAppKey } from '../registry.js';
import { getAppWallet, customerWalletView, listAppTransactions } from '../appWallet.js';
import { listPlans, toCustomerPlan } from '../plans.js';
import { getAppUsageForCompany } from '../customerUsage.js';
import { loadAppPlanContext, quoteForPrice, toCustomerQuote, bonusTiers } from '../pricing.js';
import { checkAppAccess, getSubscription } from '../subscriptions.js';

const router = Router({ mergeParams: true });

/** The app of the URL (only apps with their own wallet) and the signed-in company. */
function scope(req, res) {
  const app = String(req.params.app || '');
  if (!isAppKey(app) || app === 'nova') {
    res.status(404).json({ success: false, error: 'Unknown app' });
    return null;
  }
  const { companyId, userId } = resolveConversationTenantIds(req);
  if (!companyId || !userId) {
    res.status(400).json({ success: false, error: 'companyId and userId are required' });
    return null;
  }
  return { app, companyId: String(companyId), userId: String(userId) };
}

const guard = (fn) => async (req, res, next) => {
  try {
    const s = scope(req, res);
    if (s) await fn(s, req, res);
  } catch (err) {
    next(err);
  }
};

router.get('/:app/wallet', guard(async (s, _req, res) => {
  await checkAppAccess(s.companyId, s.app); // caps an existing unlimited company at the default credit; a new company gets nothing
  res.json({ success: true, data: customerWalletView(await getAppWallet(s.companyId, s.app), s.app) });
}));

router.get('/:app/wallet/transactions', guard(async (s, req, res) => {
  res.json({ success: true, data: await listAppTransactions(s.companyId, s.app, { limit: req.query.limit, before: req.query.before }) });
}));

router.get('/:app/usage', guard(async (s, req, res) => {
  // ?mine=1: only the signed-in employee's own usage; otherwise the whole company with the per-employee division.
  const userId = req.query.mine === '1' || req.query.mine === 'true' ? s.userId : '';
  res.json({ success: true, data: await getAppUsageForCompany(s.companyId, s.app, { from: req.query.from, to: req.query.to, userId }) });
}));

router.get('/:app/plans', guard(async (s, _req, res) => {
  const ctx = await loadAppPlanContext(s.app);
  const plans = (await listPlans(s.app, { activeOnly: true })).map((p) => toCustomerPlan(p, ctx));
  res.json({ success: true, data: { plans, custom: { min_usd: ctx.settings.custom_min_usd, max_usd: ctx.settings.custom_max_usd, bonus_tiers: bonusTiers(ctx.settings, ctx.markup) } } });
}));

router.get('/:app/plans/quote', guard(async (s, req, res) => {
  const ctx = await loadAppPlanContext(s.app);
  const amount = Number(req.query.amount);
  if (!Number.isFinite(amount) || amount < ctx.settings.custom_min_usd || amount > ctx.settings.custom_max_usd) {
    return res.status(400).json({ success: false, error: `Enter an amount between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}` });
  }
  res.json({ success: true, data: toCustomerQuote(quoteForPrice(amount, ctx.settings, ctx.markup)) });
}));

router.get('/:app/status', guard(async (s, _req, res) => {
  const [access, subscription] = await Promise.all([checkAppAccess(s.companyId, s.app), getSubscription(s.companyId, s.app)]);
  res.json({ success: true, data: { active: access.allowed, reason: access.reason, message: access.message, plan_name: subscription.plan_name } });
}));

export default router;
