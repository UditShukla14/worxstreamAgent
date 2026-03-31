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
import Conversation from '../models/Conversation.js';
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
import { getPlanState, setPlanState } from '../agents/PlanState.js';
import { getCurrentDateTimeContext } from '../utils/dateContext.js';
import { randomUUID } from 'crypto';

const router = Router();

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  // Handles ```json\n{...}\n``` and ```\n{...}\n```
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

async function selfCheckCompletion(userMessage, rawText) {
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 192,
    system: `You are a strict completion checker.\nReturn ONLY strict JSON: {"done": boolean, "next_instruction": string|null}.\nRules:\n- done=true if the user request is fully satisfied.\n- done=false only if more tool calls or steps are clearly required.\n- If done=false, next_instruction must be a short imperative instruction for the agent to continue.\n- If the agent asked the user a question to proceed, set done=true (we should wait for user input).`,
    messages: [
      {
        role: 'user',
        content: `User request:\n${userMessage}\n\nAgent raw output:\n${rawText}`,
      },
    ],
  });
  const text = response.content?.find(b => b.type === 'text')?.text?.trim() || '';
  try {
    const parsed = JSON.parse(text);
    const done = Boolean(parsed?.done);
    const next_instruction = parsed?.next_instruction == null ? null : String(parsed.next_instruction);
    return { done, next_instruction };
  } catch {
    // If checker fails, default to done (avoid infinite loops / regressions).
    return { done: true, next_instruction: null };
  }
}

/**
 * Ask Nova (orchestrator) how to plan agent calls for this request.
 * Returns a normalized plan object or null on failure.
 */
async function getNovaPlan(message, conversationContext, routing) {
  try {
    const suggestedKeys = routing.agentKeys || [];
    const allDefs = AGENT_DEFINITIONS;
    const lines = [];

    for (const [key, def] of Object.entries(allDefs)) {
      // Skip Nova itself in the summaries; Nova coordinates specialists.
      if (key === 'nova') continue;
      lines.push(`- ${key}: ${def.description}`);
    }

    const agentCatalog = lines.join('\n');
    const suggestedList = suggestedKeys.length > 0 ? suggestedKeys.join(', ') : 'none';

    const userPromptParts = [];
    if (conversationContext) {
      userPromptParts.push(`Conversation context:\n${conversationContext}`);
    }
    userPromptParts.push(
      `User message:\n${message}`,
      '',
      `Router-suggested agents: [${suggestedList}]`,
      '',
      'Available agents:',
      agentCatalog,
      '',
      'Decide how to orchestrate this request and return ONLY a JSON object with fields mode, agents, and reason as previously described.',
    );

    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens?.nova ?? 256,
      system: AGENT_DEFINITIONS.nova.systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPromptParts.join('\n'),
        },
      ],
    });

    const text = response.content[0]?.text?.trim() || '';
    let plan;
    try {
      plan = JSON.parse(stripJsonCodeFence(text));
    } catch (err) {
      console.warn('⚠️ Nova returned non-JSON plan, falling back to router-only plan:', text);
      return null;
    }

    if (!plan || !Array.isArray(plan.agents) || !plan.mode) {
      console.warn('⚠️ Nova plan missing required fields, falling back to router-only plan:', plan);
      return null;
    }

    // Normalize mode and agents
    const mode = plan.mode === 'sequential'
      ? 'sequential'
      : plan.mode === 'parallel'
        ? 'parallel'
        : 'single';
    const agents = plan.agents.map(String);
    return { mode, agents, reason: plan.reason || '' };
  } catch (error) {
    console.error('❌ Error getting Nova plan:', error);
    return null;
  }
}

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

// ── Conversations CRUD (scoped by companyId + userId) ───────────────────

// GET /api/agents/conversations?companyId=...&userId=...
router.get('/conversations', async (req, res) => {
  try {
    const { companyId, userId, limit } = req.query || {};
    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'companyId and userId are required',
      });
    }

    const company_id = String(companyId);
    const user_id = String(userId);
    const limitNum = Math.min(parseInt(limit || '50', 10) || 50, 200);

    const conversations = await Conversation.find({
      company_id,
      user_id,
    })
      .sort({ updated_at: -1 })
      .limit(limitNum)
      .select('conversation_id created_at updated_at messages')
      .lean();

    const conversationsList = conversations.map((conv) => {
      const messages = conv.messages || [];
      const firstUserMessage = messages.find((m) => m.role === 'user');
      let preview = 'New conversation';

      if (firstUserMessage) {
        if (typeof firstUserMessage.content === 'string') {
          preview = firstUserMessage.content.substring(0, 100);
        } else {
          preview = JSON.stringify(firstUserMessage.content).substring(0, 100);
        }
      }

      return {
        conversation_id: conv.conversation_id,
        preview,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        message_count: messages.length,
      };
    });

    res.json({
      success: true,
      conversations: conversationsList,
    });
  } catch (error) {
    console.error('❌ Error fetching conversations list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/agents/conversations/:conversation_id?companyId=...&userId=...
router.get('/conversations/:conversation_id', async (req, res) => {
  try {
    const { companyId, userId } = req.query || {};
    const { conversation_id } = req.params;

    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'companyId and userId are required',
      });
    }

    const company_id = String(companyId);
    const user_id = String(userId);

    const conversation = await Conversation.findOne({
      company_id,
      user_id,
      conversation_id,
    }).lean();

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation_id: conversation.conversation_id,
      messages: conversation.messages,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    });
  } catch (error) {
    console.error('❌ Error fetching conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/agents/conversations/:conversation_id?companyId=...&userId=...
router.delete('/conversations/:conversation_id', async (req, res) => {
  try {
    const { companyId, userId } = req.query || {};
    const { conversation_id } = req.params;

    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'companyId and userId are required',
      });
    }

    const company_id = String(companyId);
    const user_id = String(userId);

    const result = await Conversation.deleteOne({
      company_id,
      user_id,
      conversation_id,
    });

    if (result.deletedCount > 0) {
      res.json({ success: true, message: 'Conversation deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Conversation not found' });
    }
  } catch (error) {
    console.error('❌ Error deleting conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
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
    const { message, conversation_id, companyId, userId } = req.body || {};
    if (!message) {
      sse({ type: 'error', error: 'message is required' });
      return res.end();
    }

    if (!companyId || !userId) {
      sse({ type: 'error', error: 'companyId and userId are required' });
      return res.end();
    }

    const company_id = String(companyId);
    const user_id = String(userId);

    // Rex: start tracking this request
    rex.startRequest(requestId, message);

    // Generate a conversation_id if none provided (enables context tracking)
    const convId = conversation_id || randomUUID();
    sse({ type: 'conversation_id', conversation_id: convId });

    // Load accumulated numeric/tool context for this conversation (Redis-backed when enabled)
    const baseContext = await buildContextPrompt({ company_id, user_id, conversation_id: convId });
    const dateContext = getCurrentDateTimeContext();
    const contextPrompt = [dateContext, baseContext].filter(Boolean).join('\n\n');
    if (contextPrompt) {
      console.log(`📎 Context: ${contextPrompt}`);
    }

    // 1. Router proposes candidate agents (with context)
    const routerStart = Date.now();
    const routing = await resolveAgentKeys(message, contextPrompt);
    const routerDuration = Date.now() - routerStart;

    // Conversational-only: no specialists suggested
    if (routing.type === 'conversation') {
      rex.routerResolved(requestId, 'general', routerDuration, routing.routerUsage ?? null);
      sse({ type: 'status', label: STATUS_LABEL_THINKING });

      const generalPrompt = contextPrompt
        ? `${contextPrompt}\n\nUser message: ${message}`
        : message;

      const stream = await anthropic.messages.stream({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens?.conversation ?? 4096,
        system: 'You are a helpful assistant for Worxstream, a business management platform. Be concise and helpful.',
        messages: [{ role: 'user', content: generalPrompt }],
      });

      let fullText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sse({ type: 'text', content: event.delta.text });
        }
      }

      // Persist this conversational turn as well
      try {
        const existing = await Conversation.findOne({
          company_id,
          user_id,
          conversation_id: convId,
        }).lean();

        const messages = existing?.messages || [];
        messages.push(
          { role: 'user', content: message },
          { role: 'assistant', content: fullText },
        );

        await Conversation.findOneAndUpdate(
          { company_id, user_id, conversation_id: convId },
          {
            company_id,
            user_id,
            conversation_id: convId,
            messages,
            updated_at: new Date(),
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );
      } catch (persistError) {
        console.error('❌ Error saving conversational multi-agent conversation:', persistError);
      }

      sse({ type: 'done', agent: 'general', toolsUsed: [] });
      rex.agentFinished(requestId, 'general', Date.now() - routerStart, null);
      rex.endRequest(requestId);
      return res.end();
    }

    // 2. Nova decides how to orchestrate the agents (single vs sequential)
    const novaPlan = await getNovaPlan(message, contextPrompt, routing);
    const fallbackMode = routing.type === 'single' ? 'single' : 'sequential';
    const fallbackAgents = routing.agentKeys && routing.agentKeys.length > 0
      ? routing.agentKeys
      : [];

    const mode = novaPlan?.mode || fallbackMode;
    const plannedAgentsRaw = novaPlan?.agents && novaPlan.agents.length > 0
      ? novaPlan.agents
      : fallbackAgents;

    // Filter to valid, known agents (excluding nova itself)
    const validAgentSet = new Set(getAgentKeys().filter(k => k !== 'nova'));
    const plannedAgents = (plannedAgentsRaw || []).filter(k => validAgentSet.has(k));

    if (plannedAgents.length === 0) {
      // Fallback: treat as conversational if Nova + router both failed
      console.warn('⚠️ Nova/router produced no valid agents; falling back to conversational response.');
      rex.routerResolved(requestId, 'general', routerDuration, routing.routerUsage ?? null);
      sse({ type: 'status', label: STATUS_LABEL_THINKING });

      const generalPrompt = contextPrompt
        ? `${contextPrompt}\n\nUser message: ${message}`
        : message;

      const stream = await anthropic.messages.stream({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens?.conversation ?? 4096,
        system: 'You are a helpful assistant for Worxstream, a business management platform. Be concise and helpful.',
        messages: [{ role: 'user', content: generalPrompt }],
      });

      let fullText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sse({ type: 'text', content: event.delta.text });
        }
      }

      try {
        const existing = await Conversation.findOne({
          company_id,
          user_id,
          conversation_id: convId,
        }).lean();
        const messagesArr = existing?.messages || [];
        messagesArr.push(
          { role: 'user', content: message },
          { role: 'assistant', content: fullText },
        );
        await Conversation.findOneAndUpdate(
          { company_id, user_id, conversation_id: convId },
          {
            company_id,
            user_id,
            conversation_id: convId,
            messages: messagesArr,
            updated_at: new Date(),
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );
      } catch (persistError) {
        console.error('❌ Error saving conversational fallback conversation:', persistError);
      }

      sse({ type: 'done', agent: 'general', toolsUsed: [] });
      rex.agentFinished(requestId, 'general', Date.now() - routerStart, null);
      rex.endRequest(requestId);
      return res.end();
    }

    const primaryKey = plannedAgents[0];
    rex.routerResolved(requestId, primaryKey, routerDuration, routing.routerUsage ?? null);

    // 3. Run one or more specialist agents according to Nova's plan
    const allToolsUsed = [];
    const allToolResultPayloads = [];
    const agentRawTexts = [];
    const planRef = { company_id, user_id, conversation_id: convId };
    const planState = await getPlanState(planRef);
    const maxSelfCheckLoops = Number.isFinite(config.agentRuntime?.maxSelfCheckLoops)
      ? config.agentRuntime.maxSelfCheckLoops
      : 1;

    const runAgentsOnce = async (overrideMessage = null) => {
      const msg = overrideMessage || message;

      // Clear per-run buffers
      allToolsUsed.length = 0;
      allToolResultPayloads.length = 0;
      agentRawTexts.length = 0;

      if (mode === 'single' || plannedAgents.length === 1) {
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
          msg,
          { _rexRequestId: requestId, _conversationContext: contextPrompt },
          sse,
        );
        rex.agentFinished(requestId, agent.name, Date.now() - agentStart, usage ?? null);

        allToolsUsed.push(...toolsUsed);
        allToolResultPayloads.push(...toolResultPayloads);
        agentRawTexts.push(rawText);

        await updateContext({ company_id, user_id, conversation_id: convId }, primaryKey, toolsUsed, toolResultPayloads);
      } else if (mode === 'parallel') {
        // Parallel multi-agent orchestration (independent agents; no chained context)
        const runs = plannedAgents.map(async (key) => {
          const agent = getAgentInstance(key);
          if (!agent) {
            console.warn(`⚠️ Planned agent "${key}" not found, skipping.`);
            return null;
          }

          sse({ type: 'agent_selected', agent: key });
          sse({ type: 'status', label: getStatusLabelForAgent(key) });

          const agentStart = Date.now();
          const { rawText, toolsUsed, toolResultPayloads, usage } = await agent.runWithEvents(
            msg,
            { _rexRequestId: requestId, _conversationContext: contextPrompt },
            sse,
          );
          rex.agentFinished(requestId, agent.name, Date.now() - agentStart, usage ?? null);

          // Update context so future turns can benefit, but do not chain within this run.
          await updateContext({ company_id, user_id, conversation_id: convId }, key, toolsUsed, toolResultPayloads);

          return { rawText, toolsUsed, toolResultPayloads };
        });

        const settled = await Promise.all(runs);
        for (const r of settled) {
          if (!r) continue;
          allToolsUsed.push(...(r.toolsUsed || []));
          allToolResultPayloads.push(...(r.toolResultPayloads || []));
          agentRawTexts.push(r.rawText || '');
        }
      } else {
        // Sequential multi-agent orchestration
        let previousRawText = '';
        let previousAgentName = '';

        for (const key of plannedAgents) {
          const agent = getAgentInstance(key);
          if (!agent) {
            console.warn(`⚠️ Planned agent "${key}" not found, skipping.`);
            continue;
          }

          sse({ type: 'agent_selected', agent: key });
          sse({ type: 'status', label: getStatusLabelForAgent(key) });

          const parts = [];
          if (contextPrompt) parts.push(contextPrompt);
          if (previousRawText) {
            parts.push(
              'You are running after another agent. Use the response below as shared context: use any IDs, names, or data it already found. Do NOT make the same or equivalent API calls again when that data is already provided here.',
              `[Context from ${previousAgentName || 'previous agent'}]: ${previousRawText}`,
            );
          }
          const chainedContext = parts.length > 0 ? parts.join('\n\n') : '';

          const agentStart = Date.now();
          const { rawText, toolsUsed, toolResultPayloads, usage } = await agent.runWithEvents(
            msg,
            { _rexRequestId: requestId, _conversationContext: chainedContext, fromAgent: previousAgentName },
            sse,
          );
          rex.agentFinished(requestId, agent.name, Date.now() - agentStart, usage ?? null);

          allToolsUsed.push(...toolsUsed);
          allToolResultPayloads.push(...toolResultPayloads);
          agentRawTexts.push(rawText);

          // Update context after each agent so subsequent agents can benefit in future turns
          await updateContext({ company_id, user_id, conversation_id: convId }, key, toolsUsed, toolResultPayloads);

          previousRawText = rawText;
          previousAgentName = agent.name;
        }
      }
      return agentRawTexts.join('\n\n').trim();
    };

    // Run agents + bounded self-check continuation (no user-facing change unless incomplete)
    let combinedRawText = await runAgentsOnce();
    let attempts = planState.attempts || 0;
    for (let i = 0; i < Math.max(0, maxSelfCheckLoops); i++) {
      const check = await selfCheckCompletion(message, combinedRawText);
      if (check.done) break;
      if (!check.next_instruction) break;
      attempts += 1;
      await setPlanState(planRef, { attempts });
      combinedRawText = await runAgentsOnce(`${message}\n\n${check.next_instruction}`);
    }

    // 4. Formatter streams the final XML-formatted response (what the UI parses as <table>, etc.)
    sse({ type: 'status', label: STATUS_LABEL_FORMATTING });
    const fmtStart = Date.now();
    const formattedForUi = await formatOutputStreaming(message, combinedRawText, res);
    rex.formatterFinished(requestId, Date.now() - fmtStart);

    // Persist the same formatted text users saw live — not combinedRawText (raw agent output),
    // or history would not match streamed styling/content.
    try {
      const existing = await Conversation.findOne({
        company_id,
        user_id,
        conversation_id: convId,
      }).lean();

      const messagesArr = existing?.messages || [];
      messagesArr.push(
        { role: 'user', content: message },
        { role: 'assistant', content: formattedForUi || combinedRawText },
      );

      await Conversation.findOneAndUpdate(
        { company_id, user_id, conversation_id: convId },
        {
          company_id,
          user_id,
          conversation_id: convId,
          messages: messagesArr,
          updated_at: new Date(),
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (persistError) {
      console.error('❌ Error saving multi-agent conversation:', persistError);
      // Do not fail the SSE response on persistence problems
    }

    sse({
      type: 'done',
      agent: plannedAgents.join(', '),
      toolsUsed: allToolsUsed.map(t => ({ name: t.name, input: t.input, success: t.success })),
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
        max_tokens: config.anthropic.maxTokens?.conversationShort ?? 1024,
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
