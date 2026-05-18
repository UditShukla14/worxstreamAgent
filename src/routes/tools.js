/**
 * Tools Routes
 */

import { Router } from 'express';
import { getAnthropicTools, getAvailableTools } from '../mcp/server.js';
import { getToolIndex } from '../mcp/toolIndex.js';

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

/**
 * Debug endpoint for tool index
 */
router.get('/debug/index', (req, res) => {
  const index = getToolIndex();
  res.json({
    success: true,
    byDomain: Object.keys(index.byDomain).reduce((acc, domain) => {
      acc[domain] = index.byDomain[domain].map(t => t.name);
      return acc;
    }, {}),
    totalTools: index.tools.length,
    reportsDomain: index.byDomain?.reports || null,
  });
});

export default router;
