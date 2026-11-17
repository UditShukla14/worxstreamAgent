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
import { getToolIndex } from '../../mcp/toolIndex.js';
import { rex } from '../agents/AgentTracker.js';
import {
  runCoworkerTurn,
  runConfirmAction,
  deleteConversationFull,
} from '../agents/coworkerPipeline.js';
import {
  listConversationTurns,
  turnToApi,
} from '../agents/conversationTurns.js';
import { requireWorxstreamAuth } from '../../middleware/requireWorxstreamAuth.js';
import { resolveConversationTenantIds } from '../../utils/worxstreamCredentials.js';
import ScheduleDefinition from '../../governance/models/ScheduleDefinition.js';
import ScheduleRun from '../../governance/models/ScheduleRun.js';
import {
  activeQuery as scheduleActiveQuery,
  definitionToApi as scheduleDefinitionToApi,
  runToApi as scheduleRunToApi,
  runDetailToApi as scheduleRunDetailToApi,
} from '../../governance/schedules/routes.js';
import {
  computeNextRunAt,
  queueScheduleDefinition,
} from '../../governance/schedules/engine.js';
import {
  computeFlowNextRunAt,
  isFlowRecipe,
} from '../../governance/schedules/flowEngine.js';
import { assertNovaCredits, getWallet, walletToApi, listWalletTransactions } from '../../analytics/novaWallet.js';
import { getCompanyUsage, getUserUsage } from '../../analytics/queries.js';
import { toCustomerUsage } from '../../analytics/customerUsage.js';
import { listNovaPlans, toCustomerPlan, loadPlanContext } from '../../analytics/novaPlans.js';
import { quoteForPrice, toCustomerQuote, bonusTiers } from '../../analytics/novaPricing.js';
import { getCompanyModelChoices, setCompanyModelChoices } from '../../analytics/customerModels.js';
import { listModelCatalogForApi } from '../../analytics/modelPricing.js';
import { config } from '../../config/index.js';
import creditsRoutes from '../../billing/stripe/routes.js';
import customerAppRoutes from '../../apps/routes/customer.js';
import { creditHold } from './creditHold.js';
import { CreditExhaustedError } from '../../analytics/creditGuard.js';
import LlmUsageEvent from '../../analytics/models/LlmUsageEvent.js';
import { computeContextBudget } from '../../utils/contextBudget.js';
import { clampMarkup } from '../../analytics/costing.js';
import {
  ACTIVE_TASK_TIERS,
  DEFAULT_TASK_MODELS,
  loadTaskModels,
  sanitizeModelTiers,
  TASK_TIERS,
} from '../../analytics/taskModels.js';

const router = Router();

router.use(requireWorxstreamAuth);
router.use('/credits', creditsRoutes); // Nova credit checkout (Stripe)
router.use('/apps', customerAppRoutes); // Raven wallet, plans and trial (customer)
router.use(creditHold); // chat/route/multi/confirm/direct: hold the company's credit for the request

/**
 * Block LLM turns when the company Nova wallet is exhausted.
 * @param {string} companyId
 * @param {import('express').Response} res
 * @returns {Promise<boolean>} true if response was sent (caller must return)
 */
async function rejectIfCreditsExhausted(companyId, res) {
  const gate = await assertNovaCredits(companyId);
  if (gate.ok) return false;
  res.status(gate.status).json(gate.body);
  return true;
}

/**
 * Conversation scoping from UI login (session) or per-request companyId/userId — no .env defaults.
 * @param {import('express').Request} req
 * @returns {{ company_id: string, user_id: string }}
 */
function resolveConversationTenant(req) {
  const { companyId, userId } = resolveConversationTenantIds(req);
  if (!companyId || !userId) {
    const err = new Error('companyId and userId are required');
    err.statusCode = 400;
    throw err;
  }
  return {
    company_id: companyId,
    user_id: userId,
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {{ company_id: string, user_id: string } | null}
 */
function requireConversationTenant(req, res) {
  try {
    return resolveConversationTenant(req);
  } catch (error) {
    if (error.statusCode === 400) {
      res.status(400).json({ success: false, error: error.message });
      return null;
    }
    throw error;
  }
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
  const tenant = requireConversationTenant(req, res);
  if (!tenant) return;
  const doc = await UserPreferences.findOne({
    company_id: tenant.company_id,
    user_id: tenant.user_id,
  }).lean();
  res.json({ success: true, preferences: doc?.preferences || {} });
});

/**
 * The signed-in company's Nova wallet (customer-safe: no markup). Same payload shape as the admin view minus
 * the ops-only fields, so the web app can read it without going through Laravel.
 */
router.get('/wallet', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const wallet = walletToApi(await getWallet(tenant.company_id));
    res.json({ success: true, data: wallet });
  } catch (error) {
    console.error('wallet status error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load wallet' });
  }
});

/**
 * Usage for the signed-in company from our own usage ledger (customer view: only what the company is charged).
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/usage', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const data = await getCompanyUsage(tenant.company_id, { from: req.query.from, to: req.query.to, groupBy: 'day' });
    res.json({ success: true, data: toCustomerUsage(data) });
  } catch (error) {
    console.error('usage error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load usage' });
  }
});

/** One employee's usage in the signed-in company. */
router.get('/usage/users/:userId', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const data = await getUserUsage(tenant.company_id, req.params.userId, { from: req.query.from, to: req.query.to });
    res.json({ success: true, data: toCustomerUsage(data) });
  } catch (error) {
    console.error('user usage error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load usage' });
  }
});

/**
 * The Nova credit plans a company can buy (active only), plus the "type your own amount" plan.
 * Only what the company pays and receives: never Anthropic's cost or the margin.
 */
router.get('/plans', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const ctx = await loadPlanContext();
    const plans = (await listNovaPlans({ activeOnly: true })).map((p) => toCustomerPlan(p, ctx));
    res.json({
      success: true,
      data: {
        plans,
        custom: {
          min_usd: ctx.settings.custom_min_usd,
          max_usd: ctx.settings.custom_max_usd,
          bonus_tiers: bonusTiers(ctx.settings, ctx.markup),
        },
      },
    });
  } catch (error) {
    console.error('plans error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load plans' });
  }
});

/** What a custom amount costs and buys: ?amount=300 */
router.get('/plans/quote', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const ctx = await loadPlanContext();
    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount < ctx.settings.custom_min_usd || amount > ctx.settings.custom_max_usd) {
      return res.status(400).json({
        success: false,
        error: `Enter an amount between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}`,
      });
    }
    res.json({ success: true, data: toCustomerQuote(quoteForPrice(amount, ctx.settings, ctx.markup)) });
  } catch (error) {
    console.error('quote error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to price that amount' });
  }
});

/**
 * The model screen: for each task, the models on offer with the recommendation, the price the company is charged
 * per million tokens, and what is selected now.
 */
router.get('/company-models', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    res.json({ success: true, data: await getCompanyModelChoices(tenant.company_id) });
  } catch (error) {
    console.error('company models error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load models' });
  }
});

/** Save the company's model per task: { daily?: "model-id", medium?: "model-id" }. An empty value uses the recommendation. */
router.put('/company-models', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    res.json({ success: true, data: await setCompanyModelChoices(tenant.company_id, req.body || {}) });
  } catch (error) {
    if (/is not available/.test(error?.message || '')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('save company models error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to save models' });
  }
});

/** Credit history for the signed-in company, newest first. ?limit=25&before=<ISO date> */
router.get('/wallet/transactions', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const data = await listWalletTransactions(tenant.company_id, {
      limit: req.query.limit,
      before: req.query.before,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('wallet history error:', error?.message);
    res.status(500).json({ success: false, error: 'Failed to load wallet history' });
  }
});

/** Model catalog + resolved daily/medium/hard/advanced selections. */
router.get('/models', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const resolved = await loadTaskModels(tenant.company_id, tenant.user_id);
    const doc = await UserPreferences.findOne({
      company_id: tenant.company_id,
      user_id: tenant.user_id,
    }).lean();
    res.json({
      success: true,
      data: {
        catalog: listModelCatalogForApi(),
        tiers: ACTIVE_TASK_TIERS,
        all_tiers: TASK_TIERS,
        defaults: {
          daily: DEFAULT_TASK_MODELS.daily,
          medium: DEFAULT_TASK_MODELS.medium,
        },
        resolved: {
          daily: resolved.daily,
          medium: resolved.medium,
        },
        user_model_tiers: sanitizeModelTiers(doc?.preferences?.model_tiers),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/preferences', async (req, res) => {
  const tenant = requireConversationTenant(req, res);
  if (!tenant) return;
  const { preferences } = req.body || {};
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ success: false, error: 'preferences object is required' });
  }
  const existing = await UserPreferences.findOne({
    company_id: tenant.company_id,
    user_id: tenant.user_id,
  }).lean();
  const merged = {
    ...(existing?.preferences && typeof existing.preferences === 'object'
      ? existing.preferences
      : {}),
    ...preferences,
  };
  if (preferences.model_tiers !== undefined) {
    merged.model_tiers = sanitizeModelTiers(preferences.model_tiers);
  }
  const doc = await UserPreferences.findOneAndUpdate(
    { company_id: tenant.company_id, user_id: tenant.user_id },
    {
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      preferences: merged,
      updated_at: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ success: true, preferences: doc.preferences });
});

// ── Conversations CRUD ───────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
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
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
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
      // agent_transcript (if any legacy) is for the model only — omit from UI payloads
      messages: (conversation.messages || []).map((m) => {
        if (!m || typeof m !== 'object') return m;
        const { agent_transcript, ...rest } = m;
        return rest;
      }),
      conversation_summary: conversation.conversation_summary,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    });
  } catch (error) {
    console.error('❌ Error fetching conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Turn-by-turn agent logs + optional transcript (Claude/ChatGPT-style audit).
 * Query: ?transcript=1 to include full agent transcript per turn.
 */
router.get('/conversations/:conversation_id/turns', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const includeTranscript = req.query.transcript === '1' || req.query.transcript === 'true';
    const turns = await listConversationTurns(
      tenant.company_id,
      tenant.user_id,
      req.params.conversation_id,
    );
    res.json({
      success: true,
      conversation_id: req.params.conversation_id,
      turns: turns.map((t) => turnToApi(t, { includeTranscript })),
    });
  } catch (error) {
    console.error('❌ Error fetching conversation turns:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Context screen for one chat: how full the model's window is (exact when the
 * last call reported usage), category breakdown (estimated), and the chat's
 * lifetime token/cost totals from the usage ledger.
 */
router.get('/conversations/:conversation_id/context', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const { conversation_id } = req.params;
    const turns = await listConversationTurns(tenant.company_id, tenant.user_id, conversation_id);
    const tierModels = await loadTaskModels(tenant.company_id, tenant.user_id);
    const latest = [...turns].reverse().find((t) => t?.log?.usage?.context);
    const context = latest?.log?.usage?.context
      || (() => {
        // Older chats / no LLM turn yet: show the budget only, no usage.
        const model = tierModels.medium;
        const b = computeContextBudget({ model });
        return {
          model,
          context_window: b.contextWindow,
          usable_budget: b.usable,
          reserved_output: b.reservedOutput,
          limits_source: b.limitsSource,
          used_tokens: null,
          used_is_exact: false,
          thresholds: { soft: b.soft, hard: b.hard },
        };
      })();

    const [totals] = await LlmUsageEvent.aggregate([
      { $match: { company_id: tenant.company_id, user_id: tenant.user_id, conversation_id } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens: { $sum: '$output_tokens' },
          cache_read_input_tokens: { $sum: '$cache_read_input_tokens' },
          cache_creation_input_tokens: { $sum: '$cache_creation_input_tokens' },
          // Customer-facing amount. Legacy events (no billable field) are priced at cost + current markup.
          billable_usd: { $sum: { $ifNull: ['$billable_usd', { $multiply: ['$cost_usd', 1 + clampMarkup(config.billing?.markupRate)] }] } },
          any_estimated: { $max: { $cond: ['$cost_estimated', 1, 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      conversation_id,
      turns: turns.length,
      context,
      usage_totals: totals
        ? {
          calls: totals.calls,
          input_tokens: totals.input_tokens,
          output_tokens: totals.output_tokens,
          cache_read_input_tokens: totals.cache_read_input_tokens,
          cache_creation_input_tokens: totals.cache_creation_input_tokens,
          cost_usd: Number(totals.billable_usd.toFixed(6)),
          cost_is_estimated: totals.any_estimated === 1,
        }
        : null,
    });
  } catch (error) {
    console.error('❌ Error fetching conversation context:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/conversations/:conversation_id', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;

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
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;
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
  const requestId = randomUUID();

  try {
    const { message, conversation_id, entity_refs } = req.body || {};
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    let tenant;
    try {
      tenant = resolveConversationTenant(req);
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ success: false, error: error.message });
      }
      throw error;
    }

    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Client disconnect (Stop button aborts the fetch) cancels further model/tool rounds.
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    const sse = (data) => {
      if (res.writableEnded || res.destroyed || abortController.signal.aborted) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch {
        /* client gone */
      }
    };

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
        formatOutput: false,
        sseStreamRes: res,
        entityRefs: entity_refs,
        abortSignal: abortController.signal,
      },
    });

    if (result.type === 'clarification') {
      sse({ type: 'done', agent: 'clarification', toolsUsed: [] });
    }

    rex.endRequest(requestId);
    res.end();
  } catch (error) {
    console.error('❌ Agent stream error:', error);
    rex.endRequest(requestId, error);
    if (!res.headersSent) {
      return res.status(error instanceof CreditExhaustedError ? error.status : 500).json({
        success: false,
        ...(error instanceof CreditExhaustedError ? { code: error.code } : {}),
        error: error.message || 'Internal server error',
      });
    }
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Internal server error' })}\n\n`);
    } catch {
      /* ignore write after close */
    }
    res.end();
  }
});

// ── POST /api/agents/route — JSON (same pipeline) ────────────────────
router.post('/route', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;
    const { message, conversation_id, entity_refs } = req.body || {};
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const result = await runCoworkerTurn({
      message,
      company_id: tenant.company_id,
      user_id: tenant.user_id,
      conversation_id,
      options: {
        streamFormatter: false,
        formatOutput: false,
        entityRefs: entity_refs,
      },
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
    res.status(error instanceof CreditExhaustedError ? error.status : 500).json({ success: false, ...(error instanceof CreditExhaustedError ? { code: error.code } : {}), error: error.message });
  }
});

// ── POST /api/agents/multi ───────────────────────────────────────────
router.post('/multi', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;
    const { message, agents, mode = 'parallel', conversation_id, entity_refs } = req.body || {};

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
        formatOutput: false,
        skipClarification: false,
        entityRefs: entity_refs,
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

// ── Scribe schedules (Nova UI) — scoped by company_id + user_id like conversations ──
function scheduleOwnerFilter(tenant, extra = {}) {
  return {
    company_id: tenant.company_id,
    user_id: tenant.user_id,
    ...extra,
  };
}

router.get('/schedules', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const kind = String(req.query.kind || 'flow_recipe');
    const filter = scheduleOwnerFilter(tenant);
    if (kind !== 'all') filter.kind = kind;
    if (req.query.active_only === 'true' || req.query.active_only === '1') {
      filter.active = true;
    }
    const rows = await ScheduleDefinition.find(scheduleActiveQuery(filter))
      .sort({ updated_at: -1 })
      .limit(Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50)));
    res.json({ success: true, data: rows.map(scheduleDefinitionToApi) });
  } catch (error) {
    console.error('❌ List schedules error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/schedules/:id', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const doc = await ScheduleDefinition.findOne(scheduleActiveQuery(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    ));
    if (!doc) return res.status(404).json({ success: false, error: 'Schedule not found' });
    // Definition is already owner-scoped; do not also require run.user_id
    // (legacy runs may have empty user_id).
    const runs = await ScheduleRun.find(scheduleActiveQuery({
      company_id: tenant.company_id,
      definition_id: doc._id,
    }))
      .sort({ generated_at: -1 })
      .limit(20);
    res.json({
      success: true,
      data: {
        schedule: scheduleDefinitionToApi(doc),
        runs: runs.map(scheduleRunToApi),
      },
    });
  } catch (error) {
    console.error('❌ Get schedule error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/schedules/:id/runs/:runId', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const owned = await ScheduleDefinition.findOne(scheduleActiveQuery(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    ));
    if (!owned) return res.status(404).json({ success: false, error: 'Schedule not found' });
    const run = await ScheduleRun.findOne(scheduleActiveQuery({
      _id: req.params.runId,
      company_id: tenant.company_id,
      definition_id: owned._id,
    }));
    if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true, data: scheduleRunDetailToApi(run) });
  } catch (error) {
    console.error('❌ Get schedule run error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/schedules/:id/pause', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const doc = await ScheduleDefinition.findOne(scheduleActiveQuery(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    ));
    if (!doc) return res.status(404).json({ success: false, error: 'Schedule not found' });
    doc.active = false;
    await doc.save();
    res.json({ success: true, data: scheduleDefinitionToApi(doc) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/schedules/:id/resume', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const doc = await ScheduleDefinition.findOne(scheduleActiveQuery(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    ));
    if (!doc) return res.status(404).json({ success: false, error: 'Schedule not found' });
    doc.active = true;
    doc.next_run_at = isFlowRecipe(doc) ? computeFlowNextRunAt(doc) : computeNextRunAt(doc);
    await doc.save();
    res.json({ success: true, data: scheduleDefinitionToApi(doc) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/schedules/:id/run', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;
    const doc = await ScheduleDefinition.findOne(scheduleActiveQuery(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    ));
    if (!doc) return res.status(404).json({ success: false, error: 'Schedule not found' });
    const run = await queueScheduleDefinition(doc, {
      companyId: tenant.company_id,
      userId: tenant.user_id,
      trigger: 'manual',
    });
    res.status(202).json({ success: true, data: scheduleRunDetailToApi(run) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/schedules/:id', async (req, res) => {
  try {
    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    const doc = await ScheduleDefinition.findOne(
      scheduleOwnerFilter(tenant, { _id: req.params.id }),
    );
    if (!doc) return res.status(404).json({ success: false, error: 'Schedule not found' });
    doc.deleted_at = new Date();
    doc.active = false;
    await doc.save();
    res.json({ success: true, data: { id: String(doc._id) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/agents/:agentKey — direct specialist (same pipeline) ───
router.post('/:agentKey', async (req, res) => {
  try {
    const { agentKey } = req.params;
    if (['stream', 'route', 'multi', 'confirm', 'conversations', 'preferences', 'models', 'schedules'].includes(agentKey)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const tenant = requireConversationTenant(req, res);
    if (!tenant) return;
    if (await rejectIfCreditsExhausted(tenant.company_id, res)) return;
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
        formatOutput: false,
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
