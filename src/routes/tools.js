/**
 * Tools Routes
 */

import { Router } from 'express';
import { getAnthropicTools, getAvailableTools } from '../mcp/server.js';

const router = Router();

/**
 * Get available tools
 */
router.get('/', (req, res) => {
  const tools = getAnthropicTools();
  
  res.json({
    success: true,
    count: tools.length,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  });
});

/**
 * Get tool names only
 */
router.get('/names', (req, res) => {
  res.json({
    success: true,
    tools: getAvailableTools(),
  });
});

export default router;
