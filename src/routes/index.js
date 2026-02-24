/**
 * Routes Index - Configure all application routes
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import toolsRoutes from './tools.js';
import chatRoutes from './chat.js';
import priceComparisonRoutes from './priceComparison.js';
import authRoutes from './auth.js';
import * as worxstreamSession from '../session/worxstreamSession.js';

const router = Router();

// Session handlers (used by explicit routes below so /api/auth/session always works)
const sessionHandlers = {
  get: (req, res) => {
    const active = worxstreamSession.hasSession();
    res.json({ success: true, active, message: active ? 'Session active.' : 'No session; set via POST /api/auth/session or use .env defaults.' });
  },
  post: (req, res) => {
    const { userId, companyId, apiToken } = req.body || {};
    const ok = worxstreamSession.setSession({ userId, companyId, apiToken });
    if (!ok) return res.status(400).json({ success: false, error: 'Missing or invalid userId, companyId, or apiToken' });
    res.json({ success: true, message: 'Session set; credentials will be used until logout.' });
  },
  delete: (req, res) => {
    worxstreamSession.clearSession();
    res.json({ success: true, message: 'Session cleared.' });
  },
};

// Mount routes
router.use('/health', healthRoutes);
// Auth base (explicit so GET /api/auth and GET /auth always respond)
router.get('/api/auth', (req, res) => {
  res.json({ ok: true, session: '/api/auth/session', hint: 'POST/DELETE/GET .../session for chat backend session' });
});
router.get('/auth', (req, res) => {
  res.json({ ok: true, session: '/auth/session', hint: 'POST/DELETE/GET .../session for chat backend session' });
});
// Session: explicit top-level routes so GET/POST/DELETE /api/auth/session and /auth/session always work
router.get('/api/auth/session', sessionHandlers.get);
router.post('/api/auth/session', sessionHandlers.post);
router.delete('/api/auth/session', sessionHandlers.delete);
router.get('/auth/session', sessionHandlers.get);
router.post('/auth/session', sessionHandlers.post);
router.delete('/auth/session', sessionHandlers.delete);
router.use('/api/auth', authRoutes);
router.use('/auth', authRoutes);
router.use('/api/tools', toolsRoutes);
router.use('/api/chat', chatRoutes);
router.use('/api/price-comparison', priceComparisonRoutes);

// Root: API info and endpoint contract (for frontend baseURL + apiEndpoints alignment)
router.get('/', (req, res) => {
  res.json({
    name: 'Worxstream AI Agent API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: {
        base: '/api/auth',
        session: '/api/auth/session', // POST set, DELETE clear, GET status (chat backend session)
      },
      chat: '/api/chat',
      stream: '/api/chat/stream',
      tools: '/api/tools',
    },
  });
});

export default router;
