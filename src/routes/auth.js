/**
 * Auth routes for Worxstream session (login/logout).
 * Frontend sends credentials once on login; backend uses them until logout.
 */

import { Router } from 'express';
import * as worxstreamSession from '../session/worxstreamSession.js';

const router = Router();

/**
 * POST /api/auth/session - Set Worxstream credentials (call after user login).
 * Body: { userId, companyId, apiToken }
 */
router.post('/session', (req, res) => {
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

/**
 * DELETE /api/auth/session
 * Clear Worxstream session (call on user logout).
 */
router.delete('/session', (req, res) => {
  worxstreamSession.clearSession();
  res.json({ success: true, message: 'Session cleared.' });
});

/**
 * GET /api/auth/session
 * Returns whether an active session exists (no credentials in response).
 */
router.get('/session', (req, res) => {
  const active = worxstreamSession.hasSession();
  res.json({
    success: true,
    active,
    message: active ? 'Session active.' : 'No session; set via POST /api/auth/session or use .env defaults.',
  });
});

export default router;
