/**
 * Service-to-service endpoints for the mail service (Raven). Mounted at /api/internal.
 *   GET  /apps/:app/access?company_id=   may this company use the app right now?
 *   POST /apps/raven/usage               report one model call to be metered and billed
 *   GET  /apps/raven/credit?company_id=&user_id=&mine=   everything the Raven credit card shows (wallet, usage, history), for the mail service to serve
 */
import { Router } from 'express';
import { requireServiceAuth } from '../../middleware/requireServiceAuth.js';
import { checkAppAccess, assertApp, AppInputError } from '../subscriptions.js';
import { recordRavenUsage } from '../ravenUsage.js';
import { getAppWallet, customerWalletView, listAppTransactions } from '../appWallet.js';
import { getAppUsageForCompany } from '../customerUsage.js';

const router = Router();
router.use(requireServiceAuth);

const fail = (res, next, err) => (err instanceof AppInputError ? res.status(400).json({ success: false, error: err.message }) : next(err));

router.get('/apps/:app/access', async (req, res, next) => {
  try {
    assertApp(req.params.app);
    res.json({ success: true, data: await checkAppAccess(req.query.company_id, req.params.app) });
  } catch (err) {
    fail(res, next, err);
  }
});

router.post('/apps/raven/usage', async (req, res, next) => {
  try {
    res.json({ success: true, data: await recordRavenUsage(req.body || {}) });
  } catch (err) {
    fail(res, next, err);
  }
});

/**
 * The Raven credit card's data: the company's wallet, its usage over the last 30 days and its credit history. The credit and the
 * usage belong to the company, so everyone in it sees the same numbers. Customer-safe throughout (no markup, no provider cost).
 */
router.get('/apps/raven/credit', async (req, res, next) => {
  try {
    const companyId = String(req.query.company_id || '').trim();
    if (!companyId) throw new AppInputError('company_id is required');
    await checkAppAccess(companyId, 'raven'); // caps an existing unlimited company at the default credit; a new company gets nothing
    const [wallet, usage, transactions] = await Promise.all([
      getAppWallet(companyId, 'raven'),
      getAppUsageForCompany(companyId, 'raven'),
      listAppTransactions(companyId, 'raven', { limit: 8 }),
    ]);
    res.json({ success: true, data: { wallet: customerWalletView(wallet, 'raven'), usage, transactions } });
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
