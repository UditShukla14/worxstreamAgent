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
} from '../novaWallet.js';

const router = Router();
router.use(requireAdminAuth);

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
    if (err?.message?.includes('free_allowance_usd') || err?.message?.includes('companyId')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post('/analytics/companies/:companyId/wallet/credits', async (req, res, next) => {
  try {
    const data = await grantWalletCredits(req.params.companyId, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    if (err?.message?.includes('amount_usd') || err?.message?.includes('companyId')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

export default router;
