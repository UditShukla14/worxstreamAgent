/**
 * Worxstream session routes – same pattern as /health.
 * GET /session (status), POST /session (set), DELETE /session (clear).
 */

import { Router } from 'express';
import * as worxstreamSession from '../session/worxstreamSession.js';

const router = Router();

/** GET /session – session status (same style as GET /health) */
router.get('/', (req, res) => {
  const active = worxstreamSession.hasSession();
  res.json({
    success: true,
    active,
    message: active ? 'Session active.' : 'No session; set via POST /session or use .env defaults.',
  });
});

/** POST /session – set credentials (call after login). Body: { userId, companyId, apiToken } */
router.post('/', (req, res) => {
  const { userId, companyId, apiToken } = req.body || {};
  const ok = worxstreamSession.setSession({ userId, companyId, apiToken });
  if (!ok) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid userId, companyId, or apiToken',
    });
  }
  res.json({ success: true, message: 'Session set; credentials will be used until logout.' });
});

/** DELETE /session – clear session (call on logout) */
router.delete('/', (req, res) => {
  worxstreamSession.clearSession();
  res.json({ success: true, message: 'Session cleared.' });
});

export default router;
