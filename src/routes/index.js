/**
 * Routes Index - Configure all application routes
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import sessionRoutes from './session.js';
import toolsRoutes from './tools.js';
import priceComparisonRoutes from './priceComparison.js';
import agentRoutes from './agents.js';
import rexRoutes from './rex.js';
import webhookRoutes from './webhooks.js';
import controlRoutes from './control.js';
import mcpRoutes from './mcp.js';

const router = Router();

// Mount routes (session same pattern as health: single path, one router)
router.use('/health', healthRoutes);
router.use('/session', sessionRoutes); // GET/POST/DELETE /session
router.use('/api/auth/session', sessionRoutes); // same router, legacy auth path
router.use('/api/tools', toolsRoutes);
router.use('/api/agents', agentRoutes);
router.use('/api/rex', rexRoutes);
router.use('/api/price-comparison', priceComparisonRoutes);
router.use('/api/webhooks', webhookRoutes);
router.use('/api/control', controlRoutes);
router.use('/mcp', mcpRoutes); // MCP Streamable HTTP endpoint (external MCP clients)

// Rex UI route - handled by frontend routing
router.get('/rex', (req, res) => {
  res.redirect('/');
});

// Root: API info and endpoint contract (for frontend baseURL + apiEndpoints alignment)
router.get('/', (req, res) => {
  res.json({
    name: 'Worxstream AI Agent API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      mcp: 'POST /mcp',
      session: '/session',
      auth: { base: '/api/auth', session: '/api/auth/session' },
      tools: '/api/tools',
      agents: {
        list: 'GET /api/agents',
        stream: 'POST /api/agents/stream',
        route: 'POST /api/agents/route',
        direct: 'POST /api/agents/:agentKey',
        multi: 'POST /api/agents/multi',
        conversations: {
          list: 'GET /api/agents/conversations',
          get: 'GET /api/agents/conversations/:conversation_id',
          delete: 'DELETE /api/agents/conversations/:conversation_id',
        },
      },
      rex: {
        dashboard: 'GET /api/rex/dashboard',
        logs: 'GET /api/rex/logs',
        stream: 'GET /api/rex/stream',
      },
      control: {
        agents: 'GET /api/control/agents',
        pipelines: 'GET /api/control/pipelines',
        policies: 'GET|POST /api/control/policies',
        rules: 'GET|POST /api/control/rules',
        runs: 'GET /api/control/runs',
        alerts: 'GET /api/control/alerts',
        dashboard: 'GET /api/control/dashboard',
        reportDefinitions: 'GET|POST /api/control/report-definitions',
        reportRuns: 'GET /api/control/report-runs',
      },
      webhooks: {
        worxstream: 'POST /api/webhooks/worxstream',
      },
    },
  });
});

export default router;
