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
    model: config.llm.model,
    llm_base_url: config.llm.baseUrl,
    tools_count: getAvailableTools().length,
  });
});

export default router;
