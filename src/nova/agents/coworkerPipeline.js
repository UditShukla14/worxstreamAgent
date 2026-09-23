/**
 * Unified coworker turn pipeline — stream and JSON entry points share this spine.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import Conversation from '../models/Conversation.js';
import {
  AGENT_DEFINITIONS,
  getAgentKeys,
  getStatusLabelForAgent,
  STATUS_LABEL_FORMATTING,
  STATUS_LABEL_THINKING,
} from './agentDefinitions.js';
import { resolveAgentKeys, getAgentInstance } from './router.js';
import { formatOutput, formatOutputStreaming } from './OutputFormatter.js';
import { rex } from './AgentTracker.js';
import {
  buildContextPrompt,
  updateContext,
  applyClarificationPick,
  getContext,
  clearContext,
  saveContext,
} from './ConversationContext.js';
import { mergeWorkingSet } from './workingMemory.js';
import { clearPlanState, getPlanState, setPlanState } from './PlanState.js';
import { getCurrentDateTimeContext } from '../utils/dateContext.js';
import {
  buildOrchestratorMessages,
  buildSpecialistHistory,
  logContextUsage,
  messageContentToString,
} from '../utils/conversationHistory.js';
import {
  maybeRefreshSummary,
  formatSummaryForPrompt,
} from '../utils/conversationSummary.js';
import { detectClarificationNeeded } from './workingMemory.js';
import { executeMcpTool } from '../mcp/server.js';
import { clearPendingConfirm, getPendingConfirm } from './pendingConfirm.js';
import UserPreferences from '../models/UserPreferences.js';

const GENERAL_CHAT_SYSTEM = 'You are a helpful assistant for Worxstream, a business management platform. Be concise and helpful.';
const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

export async function loadConversationState(company_id, user_id, conversation_id) {
  try {
    const doc = await Conversation.findOne({ company_id, user_id, conversation_id }).lean();
    return {
      messages: doc?.messages || [],
      conversation_summary: doc?.conversation_summary || '',
      summary_through_turn: doc?.summary_through_turn ?? 0,
    };
  } catch (err) {
    console.warn('⚠️ Failed to load conversation:', err?.message || err);
    return { messages: [], conversation_summary: '', summary_through_turn: 0 };
  }
}

/** Compact tool transcript stored alongside the assistant message. */
function compactToolActivity(toolsUsed = []) {
  if (!Array.isArray(toolsUsed) || toolsUsed.length === 0) return null;
  return toolsUsed.slice(-10).map((t) => ({
    tool: t.name,
    input: JSON.stringify(t.input ?? {}).slice(0, 200),
    ok: t.success !== false,
    ...(t.success === false && t.error ? { error: String(t.error).slice(0, 200) } : {}),
  }));
}

async function persistConversation({
  company_id,
  user_id,
  conversation_id,
  priorMessages,
  message,
  assistantContent,
  toolsUsed,
  conversation_summary,
  summary_through_turn,
}) {
  const toolActivity = compactToolActivity(toolsUsed);
  const messagesArr = [...priorMessages];
  messagesArr.push(
    { role: 'user', content: message },
    {
      role: 'assistant',
      content: assistantContent,
      ...(toolActivity ? { tool_activity: toolActivity } : {}),
    },
  );

  let summary = conversation_summary;
  let throughTurn = summary_through_turn;
  try {
    const refreshed = await maybeRefreshSummary({
      priorMessages: messagesArr,
      existingSummary: conversation_summary,
      summaryThroughTurn: summary_through_turn,
    });
    if (refreshed) {
      summary = refreshed.summary;
      throughTurn = refreshed.throughTurn;
    }
  } catch (e) {
    console.warn('⚠️ Summary refresh skipped:', e?.message || e);
  }

  await Conversation.findOneAndUpdate(
    { company_id, user_id, conversation_id },
    {
      company_id,
      user_id,
      conversation_id,
      messages: messagesArr,
      conversation_summary: summary,
      summary_through_turn: throughTurn,
      updated_at: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { summary, throughTurn };
}

/** Cap raw output sent to the self-check — checking completeness doesn't need full payloads. */
const SELF_CHECK_MAX_CHARS = 4000;

async function selfCheckCompletion(userMessage, rawText) {
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 192,
    system: `You are a strict completion checker.\nReturn ONLY strict JSON: {"done": boolean, "next_instruction": string|null}.`,
    messages: [{ role: 'user', content: `User request:\n${userMessage}\n\nAgent raw output:\n${String(rawText || '').slice(0, SELF_CHECK_MAX_CHARS)}` }],
  });
  const text = response.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  try {
    const parsed = JSON.parse(text);
    return {
      done: Boolean(parsed?.done),
      next_instruction: parsed?.next_instruction == null ? null : String(parsed.next_instruction),
    };
  } catch {
    return { done: true, next_instruction: null };
  }
}

export async function getNovaPlan(message, conversationContext, routing, priorMessages = []) {
  try {
    const suggestedKeys = routing.agentKeys || [];
    const lines = [];
    for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
      if (key === 'nova') continue;
      lines.push(`- ${key}: ${def.description}`);
    }
    const userPromptParts = [];
    if (conversationContext) userPromptParts.push(`Conversation context:\n${conversationContext}`);
    userPromptParts.push(
      `User message:\n${message}`,
      '',
      `Router-suggested agents: [${suggestedKeys.length ? suggestedKeys.join(', ') : 'none'}]`,
      '',
      'Available agents:',
      lines.join('\n'),
      '',
      'Return ONLY JSON: { mode, agents, reason }.',
    );

    const novaSystem = AGENT_DEFINITIONS.nova.systemPrompt;
    // Planning is a control call: recent turns suffice, full history only adds latency.
    const novaMessages = buildOrchestratorMessages({
      priorMessages: priorMessages.slice(-6),
      currentUserContent: userPromptParts.join('\n'),
      systemPrompt: novaSystem,
    });
    logContextUsage('Nova context', novaMessages, novaSystem);

    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens?.nova ?? 256,
      system: novaSystem,
      messages: novaMessages,
    });

    const text = response.content[0]?.text?.trim() || '';
    const plan = JSON.parse(stripJsonCodeFence(text));
    if (!plan?.agents || !plan.mode) return null;
    const mode = plan.mode === 'sequential' ? 'sequential' : plan.mode === 'parallel' ? 'parallel' : 'single';
    return { mode, agents: plan.agents.map(String), reason: plan.reason || '' };
  } catch (error) {
    console.error('❌ Nova plan error:', error);
    return null;
  }
}

async function runGeneralChat({
  message,
  contextPrompt,
  priorMessages,
  sse,
  stream,
}) {
  const generalPrompt = contextPrompt ? `${contextPrompt}\n\nUser message: ${message}` : message;
  const generalMessages = buildOrchestratorMessages({
    priorMessages,
    currentUserContent: generalPrompt,
    systemPrompt: GENERAL_CHAT_SYSTEM,
  });
  logContextUsage('General chat context', generalMessages, GENERAL_CHAT_SYSTEM);

  if (stream) {
    const streamResp = await anthropic.messages.stream({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens?.conversation ?? 4096,
      system: GENERAL_CHAT_SYSTEM,
      messages: generalMessages,
    });
    let fullText = '';
    for await (const event of streamResp) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        sse({ type: 'text', content: event.delta.text });
      }
    }
    return fullText;
  }

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.conversation ?? 4096,
    system: GENERAL_CHAT_SYSTEM,
    messages: generalMessages,
  });
  return response.content[0]?.text || '';
}

/**
 * @param {object} params
 * @param {string} params.message
 * @param {string} params.company_id
 * @param {string} params.user_id
 * @param {string} [params.conversation_id]
 * @param {function} [params.sse]
 * @param {string} [params.requestId]
 * @param {object} [params.options]
 */
export async function runCoworkerTurn({
  message,
  company_id,
  user_id,
  conversation_id,
  sse = () => {},
  requestId = randomUUID(),
  options = {},
}) {
  const convId = conversation_id || randomUUID();
  const ctxRef = { company_id, user_id, conversation_id: convId };
  const planRef = ctxRef;

  sse({ type: 'conversation_id', conversation_id: convId });
  sse({ type: 'status', label: STATUS_LABEL_THINKING });

  // Pre-work runs in parallel: Mongo history, Redis context (after clarification pick),
  // and user preferences are independent of each other.
  const [convState, redisCtx, prefsBlock] = await Promise.all([
    loadConversationState(company_id, user_id, convId),
    applyClarificationPick(ctxRef, message).then(() => getContext(ctxRef)),
    UserPreferences.findOne({ company_id, user_id })
      .lean()
      .then((doc) =>
        doc?.preferences && Object.keys(doc.preferences).length > 0
          ? `[User preferences]\n${JSON.stringify(doc.preferences)}`
          : '',
      )
      .catch(() => ''),
  ]);

  const priorMessages = convState.messages;
  const summaryBlock = formatSummaryForPrompt(convState.conversation_summary);

  const lastAssistant = [...priorMessages].reverse().find((m) => m.role === 'assistant');
  const lastAssistantSnippet = lastAssistant
    ? messageContentToString(lastAssistant.content).slice(0, 500)
    : '';

  const baseContext = await buildContextPrompt(ctxRef, { lastAssistantSnippet });
  const dateContext = getCurrentDateTimeContext();

  const contextPrompt = [dateContext, summaryBlock, prefsBlock, baseContext].filter(Boolean).join('\n\n');

  const clarification = detectClarificationNeeded(redisCtx, message);
  if (clarification?.options?.length && !options.skipClarification) {
    sse({
      type: 'clarification',
      question: clarification.question,
      options: clarification.options,
    });
    const ctxWithClarification = {
      ...redisCtx,
      workingSet: mergeWorkingSet(redisCtx.workingSet, { pendingClarification: clarification }),
    };
    await saveContext(ctxRef, ctxWithClarification);
    return {
      conversation_id: convId,
      type: 'clarification',
      clarification,
      toolsUsed: [],
    };
  }

  const specialistHistory = buildSpecialistHistory(priorMessages, {
    workingSet: redisCtx.workingSet,
  });
  if (priorMessages.length > 0) {
    logContextUsage('Specialist context', specialistHistory);
  }

  const specialistRunContext = {
    _conversationHistory: specialistHistory,
    _planRef: planRef,
    _approvedConfirmations: options.approvedConfirmations || [],
    _skipWriteConfirm: options.skipWriteConfirm,
  };

  let routing;
  if (options.agentKeys?.length) {
    routing = {
      type: options.agentKeys.length === 1 ? 'single' : 'multi',
      agentKeys: options.agentKeys,
      routerUsage: null,
    };
  } else {
    const routerStart = Date.now();
    routing = await resolveAgentKeys(message, contextPrompt, priorMessages);
    if (requestId) rex.routerResolved?.(requestId, routing.agentKeys?.[0] || 'general', Date.now() - routerStart, routing.routerUsage);
  }

  if (routing.type === 'conversation') {
    const text = await runGeneralChat({
      message,
      contextPrompt,
      priorMessages,
      sse,
      stream: Boolean(options.streamFormatter),
    });
    sse({ type: 'done', agent: 'general', toolsUsed: [] });
    await persistConversation({
      company_id,
      user_id,
      conversation_id: convId,
      priorMessages,
      message,
      assistantContent: text,
      conversation_summary: convState.conversation_summary,
      summary_through_turn: convState.summary_through_turn,
    });
    await updateContext(ctxRef, 'general', [], [], { message, assistantSummary: text });
    return {
      conversation_id: convId,
      type: 'conversation',
      response: text,
      formattedText: text,
      agents: ['general'],
      toolsUsed: [],
    };
  }

  // Nova planning only adds value when multiple agents are in play; for a
  // single-agent route the plan is trivially that agent — skip the LLM call.
  const novaPlan = options.mode
    ? { mode: options.mode, agents: options.agentKeys || routing.agentKeys }
    : routing.type === 'single'
      ? { mode: 'single', agents: routing.agentKeys }
      : await getNovaPlan(message, contextPrompt, routing, priorMessages);

  const fallbackMode = routing.type === 'single' ? 'single' : 'sequential';
  const mode = novaPlan?.mode || options.mode || fallbackMode;
  const plannedAgentsRaw = novaPlan?.agents?.length
    ? novaPlan.agents
    : (options.agentKeys || routing.agentKeys || []);

  const validAgentSet = new Set(getAgentKeys().filter((k) => k !== 'nova'));
  const plannedAgents = plannedAgentsRaw.filter((k) => validAgentSet.has(k));

  if (plannedAgents.length === 0) {
    const text = await runGeneralChat({
      message,
      contextPrompt,
      priorMessages,
      sse,
      stream: Boolean(options.streamFormatter),
    });
    sse({ type: 'done', agent: 'general', toolsUsed: [] });
    await persistConversation({
      company_id,
      user_id,
      conversation_id: convId,
      priorMessages,
      message,
      assistantContent: text,
      conversation_summary: convState.conversation_summary,
      summary_through_turn: convState.summary_through_turn,
    });
    return {
      conversation_id: convId,
      type: 'conversation',
      response: text,
      formattedText: text,
      agents: ['general'],
      toolsUsed: [],
    };
  }

  const primaryKey = plannedAgents[0];
  const allToolsUsed = [];
  // Object tree from get_workflow_object_tree — embedded as a <workflow> tag
  // AFTER formatting so the JSON never round-trips through the formatter LLM.
  let workflowTree = null;
  const planState = await getPlanState(planRef);
  const maxSelfCheckLoops = config.agentRuntime?.maxSelfCheckLoops ?? 1;

  const runAgentsOnce = async (overrideMessage = null) => {
    const msg = overrideMessage || message;
    allToolsUsed.length = 0;
    const agentRawTexts = [];

    const runSingle = async (key, chainedContext) => {
      const agent = getAgentInstance(key);
      if (!agent) throw new Error(`Agent "${key}" not found`);
      sse({ type: 'agent_selected', agent: key });
      sse({ type: 'status', label: getStatusLabelForAgent(key) });
      const agentStart = Date.now();
      const result = await agent.runWithEvents(
        msg,
        {
          _rexRequestId: requestId,
          _conversationContext: chainedContext || contextPrompt,
          ...specialistRunContext,
        },
        sse,
      );
      if (requestId) rex.agentFinished(requestId, agent.name, Date.now() - agentStart, result.usage ?? null);
      if (result.needsConfirmation) {
        return { needsConfirmation: true, confirmationId: result.confirmationId, toolsUsed: result.toolsUsed };
      }
      allToolsUsed.push(...(result.toolsUsed || []));
      (result.toolsUsed || []).forEach((t, i) => {
        if (t.name === 'get_workflow_object_tree' && t.success !== false) {
          const payload = result.toolResultPayloads?.[i];
          // httpClient wraps the API body: payload.data = { success, data: [tree], status }
          const tree = payload?.data?.data ?? payload?.data ?? null;
          if (tree && (Array.isArray(tree) ? tree.length > 0 : typeof tree === 'object')) {
            workflowTree = tree;
          }
        }
      });
      await updateContext(ctxRef, key, result.toolsUsed, result.toolResultPayloads, {
        message: msg,
        assistantSummary: result.rawText?.slice(0, 300),
      });
      return { rawText: result.rawText };
    };

    if (mode === 'single' || plannedAgents.length === 1) {
      const out = await runSingle(primaryKey, contextPrompt);
      if (out.needsConfirmation) return out;
      agentRawTexts.push(out.rawText || '');
    } else if (mode === 'parallel') {
      const settled = await Promise.all(plannedAgents.map((key) => runSingle(key, contextPrompt)));
      for (const out of settled) {
        if (out?.needsConfirmation) return out;
        agentRawTexts.push(out?.rawText || '');
      }
    } else {
      let previousRawText = '';
      let previousAgentName = '';
      for (const key of plannedAgents) {
        const parts = [];
        if (contextPrompt) parts.push(contextPrompt);
        if (previousRawText) {
          parts.push(
            'Use shared context from the prior agent; do not repeat identical API calls.',
            `[Context from ${previousAgentName}]: ${previousRawText}`,
          );
        }
        const chained = parts.join('\n\n');
        const out = await runSingle(key, chained);
        if (out.needsConfirmation) return out;
        agentRawTexts.push(out.rawText || '');
        previousRawText = out.rawText || '';
        previousAgentName = getAgentInstance(key)?.name || key;
      }
    }

    return { combinedRawText: agentRawTexts.join('\n\n').trim() };
  };

  let runResult = await runAgentsOnce();
  if (runResult.needsConfirmation) {
    sse({
      type: 'done',
      agent: primaryKey,
      toolsUsed: [],
      pending_confirmation: true,
      confirmationId: runResult.confirmationId,
    });
    return {
      conversation_id: convId,
      type: 'pending_confirmation',
      confirmationId: runResult.confirmationId,
      toolsUsed: [],
    };
  }

  let combinedRawText = runResult.combinedRawText || '';
  let attempts = planState.attempts || 0;
  for (let i = 0; i < Math.max(0, maxSelfCheckLoops); i++) {
    const check = await selfCheckCompletion(message, combinedRawText);
    if (check.done || !check.next_instruction) break;
    attempts += 1;
    await setPlanState(planRef, { attempts });
    runResult = await runAgentsOnce(`${message}\n\n${check.next_instruction}`);
    if (runResult.needsConfirmation) {
      sse({ type: 'done', agent: plannedAgents.join(', '), pending_confirmation: true });
      return { conversation_id: convId, type: 'pending_confirmation', confirmationId: runResult.confirmationId };
    }
    combinedRawText = runResult.combinedRawText || combinedRawText;
  }

  sse({ type: 'status', label: STATUS_LABEL_FORMATTING });
  let formattedForUi = combinedRawText;
  if (options.streamFormatter && options.sseStreamRes) {
    const fmtStart = Date.now();
    formattedForUi = await formatOutputStreaming(message, combinedRawText, options.sseStreamRes);
    if (requestId) rex.formatterFinished(requestId, Date.now() - fmtStart);
  } else if (options.formatOutput !== false) {
    formattedForUi = await formatOutput(message, combinedRawText);
  }

  // Deterministic <workflow> embedding: the React Flow tree renders from this
  // JSON; appending it server-side guarantees byte-exact data in the UI.
  if (workflowTree && !/<workflow[\s>]/i.test(formattedForUi || '')) {
    const treeJson = JSON.stringify(workflowTree);
    if (treeJson.length <= 60000) {
      const workflowXml = `\n\n<workflow>${treeJson}</workflow>`;
      formattedForUi = `${formattedForUi || ''}${workflowXml}`;
      if (options.streamFormatter && options.sseStreamRes) {
        sse({ type: 'text', content: workflowXml });
      }
    }
  }

  const persisted = await persistConversation({
    company_id,
    user_id,
    conversation_id: convId,
    priorMessages,
    message,
    assistantContent: formattedForUi || combinedRawText,
    toolsUsed: allToolsUsed,
    conversation_summary: convState.conversation_summary,
    summary_through_turn: convState.summary_through_turn,
  });

  await updateContext(ctxRef, primaryKey, allToolsUsed, [], {
    message,
    assistantSummary: (formattedForUi || '').slice(0, 500),
  });

  sse({
    type: 'done',
    agent: plannedAgents.join(', '),
    toolsUsed: allToolsUsed.map((t) => ({ name: t.name, input: t.input, success: t.success })),
  });

  return {
    conversation_id: convId,
    type: mode,
    agents: plannedAgents,
    response: formattedForUi,
    formattedText: formattedForUi,
    rawText: combinedRawText,
    toolsUsed: allToolsUsed,
    conversation_summary: persisted.summary,
  };
}

/**
 * POST /api/agents/confirm — execute or reject a pending write tool.
 */
export async function runConfirmAction({
  company_id,
  user_id,
  conversation_id,
  confirmationId,
  approved,
}) {
  const ctxRef = { company_id, user_id, conversation_id };
  const pending = await getPendingConfirm(ctxRef);
  if (!pending || pending.confirmationId !== confirmationId) {
    return { success: false, error: 'No matching pending confirmation' };
  }

  await clearPendingConfirm(ctxRef);

  if (!approved) {
    return { success: true, approved: false, message: 'Write cancelled by user' };
  }

  const result = await executeMcpTool(pending.tool, pending.input, {
    agent: pending.agentKey,
    userMessage: pending.userMessage,
  });

  await updateContext(
    ctxRef,
    pending.agentKey || 'unknown',
    [{ name: pending.tool, input: pending.input, success: result.success }],
    [result],
    { message: `[Confirmed] ${pending.tool}` },
  );

  return { success: true, approved: true, tool: pending.tool, result };
}

export async function deleteConversationFull(company_id, user_id, conversation_id) {
  await Conversation.deleteOne({ company_id, user_id, conversation_id });
  await clearContext({ company_id, user_id, conversation_id });
  await clearPlanState({ company_id, user_id, conversation_id });
  await clearPendingConfirm({ company_id, user_id, conversation_id });
}
