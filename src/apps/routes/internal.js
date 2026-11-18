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
 * The Raven credit card's data. The mail service has already verified who is asking and whether they administer the company, and
 * passes `mine=1` for anyone else: then only that employee's own usage is returned, and no credit history. Customer-safe throughout.
 */
router.get('/apps/raven/credit', async (req, res, next) => {
  try {
    const companyId = String(req.query.company_id || '').trim();
    if (!companyId) throw new AppInputError('company_id is required');
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const userId = String(req.query.user_id || '').trim();
    if (mine && !userId) throw new AppInputError('user_id is required with mine=1');
    await checkAppAccess(companyId, 'raven'); // caps an existing unlimited company at the default credit; a new company gets nothing
    const [wallet, usage, transactions] = await Promise.all([
      getAppWallet(companyId, 'raven'),
      getAppUsageForCompany(companyId, 'raven', { userId: mine ? userId : '' }),
      mine ? [] : listAppTransactions(companyId, 'raven', { limit: 8 }),
    ]);
    res.json({ success: true, data: { wallet: customerWalletView(wallet, 'raven'), usage, transactions } });
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
