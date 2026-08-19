/**
 * Agent Routes — Multi-agent API endpoints (coworker pipeline spine).
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import Conversation from '../models/Conversation.js';
import UserPreferences from '../models/UserPreferences.js';
import {
  AGENT_DEFINITIONS,
  getAgentKeys,
} from '../agents/agentDefinitions.js';
import { getToolIndex } from '../mcp/toolIndex.js';
import { rex } from '../agents/AgentTracker.js';
import {
  runCoworkerTurn,
  runConfirmAction,
  deleteConversationFull,
} from '../agents/coworkerPipeline.js';
import { requireWorxstreamAuth } from '../middleware/requireWorxstreamAuth.js';
import { resolveAgentCredentials } from '../utils/worxstreamCredentials.js';

const router = Router();

router.use(requireWorxstreamAuth);

/** Conversation scoping from UI login (session) or per-request companyId/userId — no .env defaults. */
function resolveConversationTenant(req) {
  const { companyId, userId } = resolveAgentCredentials(req);
  return {
    company_id: String(companyId),
    user_id: String(userId),
  };
}

// ── GET /api/agents — list available agents ──────────────────────────
router.get('/', (req, res) => {
  const index = getToolIndex();
  const agents = Object.entries(AGENT_DEFINITIONS).map(([key, def]) => ({
    key,
    name: def.name,
    description: def.description,
    domain: def.domain || key,
    toolCount: index.byDomain?.[def.domain || key]?.length ?? 0,
  }));

  res.json({ success: true, agents, count: agents.length });
});

// ── Preferences (cross-session coworker) ─────────────────────────────
router.get('/preferences', async (req, res) => {
  const tenant = resolveConversationTenant(req);
  const doc = await UserPreferences.findOne({
    company_id: tenant.company_id,
    user_id: tenant.user_id,
  }).lean();
  res.json({ success: true, preferences: doc?.preferences || {} });
});

router.patch('/preferences', async (req, res) => {
  const tenant = resolveConversationTenant(req);
  const { preferences } = req.body || {};
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ success: false, error: 'preferences object is required' });
  }
  const doc = await UserPreferences.findOneAndUpdate(
    { company_id: tenant.company_id, user_id: tenant.user_id },
    {
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      preferences,
      updated_at: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ success: true, preferences: doc.preferences });
});

// ── Conversations CRUD ───────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);
    const limitNum = Math.min(parseInt(req.query?.limit || '50', 10) || 50, 200);

    const conversations = await Conversation.find({
      company_id: tenant.company_id,
      user_id: tenant.user_id,
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
        preview = typeof firstUserMessage.content === 'string'
          ? firstUserMessage.content.substring(0, 100)
          : JSON.stringify(firstUserMessage.content).substring(0, 100);
      }
      return {
        conversation_id: conv.conversation_id,
        preview,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        message_count: messages.length,
      };
    });

    res.json({ success: true, conversations: conversationsList });
  } catch (error) {
    console.error('❌ Error fetching conversations list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/conversations/:conversation_id', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);
    const conversation = await Conversation.findOne({
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id: req.params.conversation_id,
    }).lean();

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation_id: conversation.conversation_id,
      messages: conversation.messages,
      conversation_summary: conversation.conversation_summary,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    });
  } catch (error) {
    console.error('❌ Error fetching conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/conversations/:conversation_id', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);

    const result = await Conversation.deleteOne({
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id: req.params.conversation_id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    await deleteConversationFull(
      tenant.company_id,
      tenant.user_id,
      req.params.conversation_id,
    );

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    console.error('❌ Error deleting conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/confirm — approve/reject pending write ──────────
router.post('/confirm', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);
    const { conversation_id, confirmationId, approved } = req.body || {};
    if (!conversation_id || !confirmationId) {
      return res.status(400).json({
        success: false,
        error: 'conversation_id and confirmationId are required',
      });
    }
    const result = await runConfirmAction({
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id: String(conversation_id),
      confirmationId: String(confirmationId),
      approved: Boolean(approved),
    });
    res.json(result);
  } catch (error) {
    console.error('❌ Confirm error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/stream — primary SSE endpoint ───────────────────
router.post('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const requestId = randomUUID();

  try {
    const { message, conversation_id } = req.body || {};
    if (!message) {
      sse({ type: 'error', error: 'message is required' });
      return res.end();
    }

    const tenant = resolveConversationTenant(req);

    rex.startRequest(requestId, message);

    const result = await runCoworkerTurn({
      message,
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id,
      sse,
      requestId,
      options: {
        streamFormatter: true,
        sseStreamRes: res,
      },
    });

    if (result.type === 'clarification') {
      sse({ type: 'done', agent: 'clarification', toolsUsed: [] });
    }

    rex.endRequest(requestId);
    res.end();
  } catch (error) {
    console.error('❌ Agent stream error:', error);
    sse({ type: 'error', error: error.message || 'Internal server error' });
    rex.endRequest(requestId, error);
    res.end();
  }
});

// ── POST /api/agents/route — JSON (same pipeline) ────────────────────
router.post('/route', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);
    const { message, conversation_id } = req.body || {};
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const result = await runCoworkerTurn({
      message,
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id,
      options: { streamFormatter: false, formatOutput: true },
    });

    res.json({
      success: true,
      type: result.type,
      conversation_id: result.conversation_id,
      response: result.response,
      agents_used: result.agents || [],
      tools_used: result.toolsUsed || [],
    });
  } catch (error) {
    console.error('❌ Agent route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/multi ───────────────────────────────────────────
router.post('/multi', async (req, res) => {
  try {
    const tenant = resolveConversationTenant(req);
    const { message, agents, mode = 'parallel', conversation_id } = req.body || {};

    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    if (!Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ success: false, error: 'agents array is required' });
    }

    const invalidKeys = agents.filter((k) => !getAgentKeys().includes(k));
    if (invalidKeys.length) {
      return res.status(400).json({
        success: false,
        error: `Unknown agent(s): ${invalidKeys.join(', ')}`,
      });
    }

    const result = await runCoworkerTurn({
      message,
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id,
      options: {
        agentKeys: agents,
        mode: mode === 'sequential' ? 'sequential' : 'parallel',
        streamFormatter: false,
        skipClarification: false,
      },
    });

    res.json({
      success: true,
      mode,
      conversation_id: result.conversation_id,
      response: result.response,
      agents_used: agents,
      tools_used: result.toolsUsed || [],
    });
  } catch (error) {
    console.error('❌ Multi-agent error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/:agentKey — direct specialist (same pipeline) ───
router.post('/:agentKey', async (req, res) => {
  try {
    const { agentKey } = req.params;
    if (['stream', 'route', 'multi', 'confirm', 'conversations', 'preferences'].includes(agentKey)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const tenant = resolveConversationTenant(req);
    const { message, conversation_id } = req.body || {};
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    if (!getAgentKeys().includes(agentKey)) {
      return res.status(404).json({
        success: false,
        error: `Unknown agent: "${agentKey}"`,
      });
    }

    const result = await runCoworkerTurn({
      message,
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id,
      options: {
        agentKeys: [agentKey],
        mode: 'single',
        streamFormatter: false,
      },
    });

    res.json({
      success: true,
      agent: agentKey,
      conversation_id: result.conversation_id,
      response: result.response,
      tools_used: result.toolsUsed || [],
    });
  } catch (error) {
    console.error('❌ Agent call error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
