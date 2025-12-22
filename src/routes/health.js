/**
 * Health Check Routes
 */

import { Router } from 'express';
import { config } from '../config/index.js';
import { getAvailableTools } from '../mcp/server.js';

const router = Router();

/**
 * Health check endpoint
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    model: config.anthropic.model,
    tools_count: getAvailableTools().length,
  });
});

export default router;
