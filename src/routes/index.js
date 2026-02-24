/**
 * Routes Index - Configure all application routes
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import toolsRoutes from './tools.js';
import chatRoutes from './chat.js';
import priceComparisonRoutes from './priceComparison.js';
import authRoutes from './auth.js';

const router = Router();

// Mount routes
router.use('/health', healthRoutes);
// Auth: mount and also explicit GET so base path always responds (avoids mount path edge cases)
router.get('/api/auth', (req, res) => {
  res.json({ ok: true, session: '/api/auth/session', hint: 'POST/DELETE/GET .../session for chat backend session' });
});
router.get('/auth', (req, res) => {
  res.json({ ok: true, session: '/auth/session', hint: 'POST/DELETE/GET .../session for chat backend session' });
});
router.use('/api/auth', authRoutes);
router.use('/auth', authRoutes); // also under /auth so both /api/auth/session and /auth/session work
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
