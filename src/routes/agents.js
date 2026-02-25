/**
 * Agent Routes — Multi-agent API endpoints.
 *
 * POST /api/agents/route          — LLM router picks agent(s) automatically
 * POST /api/agents/:agentKey      — Call a specific agent directly
 * POST /api/agents/multi          — Call multiple agents (parallel or sequential)
 * GET  /api/agents                — List all available agents
 */

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import {
  routeToAgents,
  resolveAgentKeys,
  callAgent,
  callAgentsParallel,
  callAgentsSequential,
  getAgentInstance,
  AGENT_DEFINITIONS,
  getAgentKeys,
  getStatusLabelForAgent,
  STATUS_LABEL_THINKING,
  STATUS_LABEL_FORMATTING,
} from '../agents/index.js';
import { formatOutputStreaming } from '../agents/OutputFormatter.js';
import { rex } from '../agents/AgentTracker.js';
import { buildContextPrompt, updateContext } from '../agents/ConversationContext.js';
import { randomUUID } from 'crypto';

const router = Router();

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// ── GET /api/agents — list available agents ──────────────────────────
router.get('/', (req, res) => {
  const agents = Object.entries(AGENT_DEFINITIONS).map(([key, def]) => ({
    key,
    name: def.name,
    description: def.description,
    toolCount: def.tools.length,
  }));

  res.json({ success: true, agents, count: agents.length });
});

// ── POST /api/agents/stream — auto-route + SSE streaming ─────────────
// PRIMARY endpoint for the frontend. Flow:
//   1. Router LLM picks the right specialist agent
//   2. Specialist runs tool loop (emits tool_use/tool_result SSE events)
//   3. Specialist returns raw text (no formatting tokens in its prompt)
//   4. OutputFormatter streams the formatted XML response (formatting
//      rules loaded ONCE here, not in every specialist iteration)
router.post('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const requestId = randomUUID();

  try {
    const { message, conversation_id } = req.body;
    if (!message) {
      sse({ type: 'error', error: 'message is required' });
      return res.end();
    }

    // Rex: start tracking this request
    rex.startRequest(requestId, message);

    // Generate a conversation_id if none provided (enables context tracking)
    const convId = conversation_id || randomUUID();
    sse({ type: 'conversation_id', conversation_id: convId });

    // Load accumulated context for this conversation
    const contextPrompt = buildContextPrompt(convId);
    if (contextPrompt) {
      console.log(`📎 Context: ${contextPrompt}`);
    }

    // 1. Router decides which agent(s) to invoke (with context)
    const routerStart = Date.now();
    const routing = await resolveAgentKeys(message, contextPrompt);
    const routerDuration = Date.now() - routerStart;

    if (routing.type === 'conversation') {
      rex.routerResolved(requestId, 'general', routerDuration, routing.routerUsage ?? null);
      sse({ type: 'status', label: STATUS_LABEL_THINKING });

      const generalPrompt = contextPrompt
        ? `${contextPrompt}\n\nUser message: ${message}`
        : message;

      const stream = await anthropic.messages.stream({
        model: config.anthropic.model,
        max_tokens: 4096,
        system: 'You are a helpful assistant for Worxstream, a business management platform. Be concise and helpful.',
        messages: [{ role: 'user', content: generalPrompt }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          sse({ type: 'text', content: event.delta.text });
        }
      }

      sse({ type: 'done', agent: 'general', toolsUsed: [] });
      rex.agentFinished(requestId, 'general', Date.now() - routerStart, null);
      rex.endRequest(requestId);
      return res.end();
    }

    // 2. Run the specialist agent — with conversation context injected
    const primaryKey = routing.agentKeys[0];
    rex.routerResolved(requestId, primaryKey, routerDuration, routing.routerUsage ?? null);

    const agent = getAgentInstance(primaryKey);
    if (!agent) {
      sse({ type: 'error', error: `Agent "${primaryKey}" not found` });
      rex.endRequest(requestId, new Error(`Agent "${primaryKey}" not found`));
      return res.end();
    }

    sse({ type: 'agent_selected', agent: primaryKey });
    sse({ type: 'status', label: getStatusLabelForAgent(primaryKey) });

    const agentStart = Date.now();
    const { rawText, toolsUsed, toolResultPayloads, usage } = await agent.runWithEvents(
      message,
      { _rexRequestId: requestId, _conversationContext: contextPrompt },
      sse,
    );
    rex.agentFinished(requestId, agent.name, Date.now() - agentStart, usage ?? null);

    // Save context: extract numeric fields from tool inputs + results
    updateContext(convId, primaryKey, toolsUsed, toolResultPayloads);

    // 3. Formatter streams the final XML-formatted response
    sse({ type: 'status', label: STATUS_LABEL_FORMATTING });
    const fmtStart = Date.now();
    await formatOutputStreaming(message, rawText, res);
    rex.formatterFinished(requestId, Date.now() - fmtStart);

    sse({
      type: 'done',
      agent: agent.name,
      toolsUsed: toolsUsed.map(t => ({ name: t.name, input: t.input, success: t.success })),
    });

    rex.endRequest(requestId);
    res.end();
  } catch (error) {
    console.error('❌ Agent stream error:', error);
    sse({ type: 'error', error: error.message || 'Internal server error' });
    rex.endRequest(requestId, error);
    res.end();
  }
});

// ── POST /api/agents/route — auto-route via LLM ─────────────────────
router.post('/route', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const routerResult = await routeToAgents(message);

    // If it was a conversation (no agent needed), reply with a simple Claude call
    if (routerResult.type === 'conversation') {
      const conversationResponse = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: 1024,
        system: 'You are a helpful assistant for Worxstream, a business management platform. Be concise.',
        messages: [{ role: 'user', content: message }],
      });

      return res.json({
        success: true,
        type: 'conversation',
        response: conversationResponse.content[0]?.text || '',
        agents_used: [],
      });
    }

    // Combine raw agent responses, then format once
    const rawCombined = routerResult.results.map(r => r.response).join('\n\n');
    const { formatOutput } = await import('../agents/OutputFormatter.js');
    const combinedResponse = await formatOutput(message, rawCombined);
    const allToolsUsed = routerResult.results.flatMap(r => r.toolsUsed || []);
    const totalUsage = routerResult.results.reduce((acc, r) => ({
      input_tokens: acc.input_tokens + (r.usage?.input_tokens || 0),
      output_tokens: acc.output_tokens + (r.usage?.output_tokens || 0),
      total_tokens: acc.total_tokens + (r.usage?.total_tokens || 0),
    }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });

    // Add router's own token usage
    if (routerResult.routerUsage) {
      totalUsage.input_tokens += routerResult.routerUsage.input_tokens || 0;
      totalUsage.output_tokens += routerResult.routerUsage.output_tokens || 0;
      totalUsage.total_tokens += (routerResult.routerUsage.input_tokens || 0) + (routerResult.routerUsage.output_tokens || 0);
    }

    res.json({
      success: true,
      type: routerResult.type,
      response: combinedResponse,
      agents_used: routerResult.agentKeys,
      tools_used: allToolsUsed,
      usage: totalUsage,
    });
  } catch (error) {
    console.error('❌ Agent route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/multi — call multiple agents ────────────────────
router.post('/multi', async (req, res) => {
  try {
    const { message, agents, mode = 'parallel' } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ success: false, error: 'agents array is required' });
    }

    const validKeys = getAgentKeys();
    const invalidKeys = agents.filter(k => !validKeys.includes(k));
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Unknown agent(s): ${invalidKeys.join(', ')}. Available: ${validKeys.join(', ')}`,
      });
    }

    let results;
    if (mode === 'sequential') {
      results = await callAgentsSequential(agents, message);
    } else {
      results = await callAgentsParallel(agents, message);
    }

    const combinedResponse = results.map(r => r.response).join('\n\n');
    const allToolsUsed = results.flatMap(r => r.toolsUsed || []);
    const totalUsage = results.reduce((acc, r) => ({
      input_tokens: acc.input_tokens + (r.usage?.input_tokens || 0),
      output_tokens: acc.output_tokens + (r.usage?.output_tokens || 0),
      total_tokens: acc.total_tokens + (r.usage?.total_tokens || 0),
    }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });

    res.json({
      success: true,
      mode,
      response: combinedResponse,
      agents_used: agents,
      results: results.map(r => ({
        agent: r.agent,
        response: r.response,
        tools_used: r.toolsUsed,
        usage: r.usage,
      })),
      tools_used: allToolsUsed,
      usage: totalUsage,
    });
  } catch (error) {
    console.error('❌ Multi-agent error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/:agentKey — call a specific agent directly ──────
router.post('/:agentKey', async (req, res) => {
  try {
    const { agentKey } = req.params;
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const agent = getAgentInstance(agentKey);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: `Unknown agent: "${agentKey}". Available: ${getAgentKeys().join(', ')}`,
      });
    }

    const result = await callAgent(agentKey, message, context || {});

    res.json({
      success: true,
      agent: result.agent,
      response: result.response,
      tools_used: result.toolsUsed,
      usage: result.usage,
    });
  } catch (error) {
    console.error('❌ Agent call error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
