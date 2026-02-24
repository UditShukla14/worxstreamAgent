/**
 * Routes Index - Configure all application routes
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import sessionRoutes from './session.js';
import toolsRoutes from './tools.js';
import chatRoutes from './chat.js';
import priceComparisonRoutes from './priceComparison.js';
import authRoutes from './auth.js';

const router = Router();

// Mount routes (session same pattern as health: single path, one router)
router.use('/health', healthRoutes);
router.use('/session', sessionRoutes); // GET/POST/DELETE /session
router.use('/api/auth', authRoutes);
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
      session: '/session', // GET status, POST set, DELETE clear (same pattern as /health)
      auth: { base: '/api/auth', session: '/api/auth/session' },
      chat: '/api/chat',
      stream: '/api/chat/stream',
      tools: '/api/tools',
    },
  });
});

export default router;
