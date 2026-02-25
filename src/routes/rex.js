/**
 * Rex — Admin monitoring routes.
 *
 * GET  /rex                — Admin dashboard UI
 * GET  /api/rex/dashboard  — JSON snapshot of all agent stats
 * GET  /api/rex/logs       — Recent request logs
 * GET  /api/rex/stream     — SSE real-time event feed
 */

import { Router } from 'express';
import { rex } from '../agents/AgentTracker.js';
import { getAgentKeys, AGENT_DEFINITIONS } from '../agents/index.js';
const router = Router();

// ── GET /api/rex/dashboard — JSON snapshot ───────────────────────────
router.get('/dashboard', (req, res) => {
  const dashboard = rex.getDashboardData();

  const registeredAgents = getAgentKeys().map(key => ({
    key,
    name: AGENT_DEFINITIONS[key].name,
    description: AGENT_DEFINITIONS[key].description,
    toolCount: AGENT_DEFINITIONS[key].tools.length,
  }));

  res.json({
    success: true,
    ...dashboard,
    registeredAgents,
  });
});

// ── GET /api/rex/logs — recent activity ──────────────────────────────
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ success: true, logs: rex.getLogs(limit) });
});

// ── GET /api/rex/stream — SSE real-time feed ─────────────────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Send initial snapshot
  send({ type: 'snapshot', data: rex.getDashboardData() });

  const unsubscribe = rex.subscribe(send);

  req.on('close', () => {
    unsubscribe();
  });
});

export default router;
