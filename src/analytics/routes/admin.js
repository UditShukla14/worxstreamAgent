/**
 * Platform admin analytics routes — token usage billing.
 */

import { Router } from 'express';
import { requireAdminAuth } from '../../middleware/requireAdminAuth.js';
import {
  getOverview,
  listCompanies,
  getCompanyUsage,
  getUserUsage,
} from '../queries.js';

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

export default router;
