/**
 * Service-to-service endpoints for the mail service (Raven). Mounted at /api/internal.
 *   GET  /apps/:app/access?company_id=   may this company use the app right now?
 *   POST /apps/raven/usage               report one model call to be metered and billed
 */
import { Router } from 'express';
import { requireServiceAuth } from '../../middleware/requireServiceAuth.js';
import { checkAppAccess, assertApp, AppInputError } from '../subscriptions.js';
import { recordRavenUsage } from '../ravenUsage.js';

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

export default router;
