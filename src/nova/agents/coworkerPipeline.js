/**
 * Unified coworker turn pipeline — stream and JSON entry points share this spine.
 */

import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import Conversation from '../models/Conversation.js';
import {
  STATUS_LABEL_PLANNING,
} from './agentDefinitions.js';
import { startActivityKeywordRotation } from './activityKeywords.js';
import {
  formatExecutionPlanForPrompt,
  getExecutionPlan,
  planToTaskState,
} from './executionPlan.js';
import { getAgentInstance } from './router.js';
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
import { clearPlanState } from './PlanState.js';
import { getCurrentDateTimeContext } from '../../utils/dateContext.js';
import {
  buildOrchestratorMessages,
  logContextUsage,
  messageContentToString,
} from '../../utils/conversationHistory.js';
import {
  maybeRefreshSummary,
  formatSummaryForPrompt,
} from '../../utils/conversationSummary.js';
import { detectClarificationNeeded } from './workingMemory.js';
import { executeMcpTool } from '../../mcp/server.js';
import { clearPendingConfirm, getPendingConfirm } from './pendingConfirm.js';
import UserPreferences from '../models/UserPreferences.js';
import {
  appendConversationTurn,
  deleteConversationTurns,
  listConversationTurns,
  turnsToPriorMessages,
} from './conversationTurns.js';

/** User asks to resume a mid-task agent run. */
function isContinueMessage(message) {
  const t = String(message || '').trim();
  if (!t) return false;
  return /^(continue|keep\s+going|resume|go\s+on|carry\s+on)[.!\s]*$/i.test(t);
}

function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

export async function loadConversationState(company_id, user_id, conversation_id) {
  try {
    const [doc, turns] = await Promise.all([
      Conversation.findOne({ company_id, user_id, conversation_id }).lean(),
      listConversationTurns(company_id, user_id, conversation_id),
    ]);

    // Prefer professional turn documents for agent memory when available.
    const fromTurns = turnsToPriorMessages(turns);
    const messages = fromTurns.length > 0 ? fromTurns : (doc?.messages || []);

    return {
      messages,
      conversation_summary: doc?.conversation_summary || '',
      summary_through_turn: doc?.summary_through_turn ?? 0,
      turns,
    };
  } catch (err) {
    console.warn('⚠️ Failed to load conversation:', err?.message || err);
    return { messages: [], conversation_summary: '', summary_through_turn: 0, turns: [] };
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
  requestId,
  agentTranscript,
  plan = null,
  usage = null,
  agentKey = 'nova',
  agents = null,
  status = 'completed',
  mode = 'coworker',
}) {
  const toolActivity = compactToolActivity(toolsUsed);
  const transcript = Array.isArray(agentTranscript) && agentTranscript.length > 0
    ? agentTranscript
    : null;

  // UI timeline stays lean — strip agent_transcript if prior was hydrated from turns.
  const leanPrior = (priorMessages || []).map((m) => {
    if (!m || typeof m !== 'object') return m;
    if (m.role === 'user') return { role: 'user', content: m.content };
    const row = { role: 'assistant', content: m.content };
    if (m.tool_activity) row.tool_activity = m.tool_activity;
    return row;
  });

  const messagesArr = [...leanPrior];
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
    let sessionHints = null;
    try {
      const liveCtx = await getContext({ company_id, user_id, conversation_id });
      sessionHints = {
        workingSet: liveCtx?.workingSet,
        entities: liveCtx?.entities,
        entityRefs: liveCtx?.entityRefs,
        toolsUsed,
      };
    } catch {
      sessionHints = { toolsUsed };
    }

    const refreshed = await maybeRefreshSummary({
      priorMessages: messagesArr,
      existingSummary: conversation_summary,
      summaryThroughTurn: summary_through_turn,
      usageMeta: {
        companyId: company_id,
        userId: user_id,
        conversationId: conversation_id,
        requestId,
      },
      sessionHints,
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

  // Professional turn document (transcript + observability log).
  const userTurnCount = messagesArr.filter((m) => m?.role === 'user').length;
  await appendConversationTurn({
    company_id,
    user_id,
    conversation_id,
    userContent: message,
    uiContent: assistantContent,
    agentTranscript: transcript || [],
    toolsUsed,
    plan,
    usage,
    agentKey,
    agents,
    status,
    mode,
    requestId,
    turnIndex: Math.max(0, userTurnCount - 1),
  });

  return { summary, throughTurn };
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
  const usageMeta = {
    companyId: company_id,
    userId: user_id,
    conversationId: convId,
    requestId,
  };
  const tenantRunFields = {
    _companyId: company_id,
    _userId: user_id,
    _conversationId: convId,
  };

  sse({ type: 'conversation_id', conversation_id: convId });
  let stopActivityKeywords = startActivityKeywordRotation(sse);
  const setStatus = (label) => {
    if (stopActivityKeywords) {
      stopActivityKeywords();
      stopActivityKeywords = null;
    }
    if (label) sse({ type: 'status', label });
  };

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
    if (stopActivityKeywords) {
      stopActivityKeywords();
      stopActivityKeywords = null;
    }
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

  if (options.agentKeys?.length || options.mode === 'specialists') {
    console.warn(
      '⚠️ Chat is Nova coworker-only; ignoring specialist agentKeys/mode and running Nova with full company tools.',
    );
  }

  // ── Nova coworker: one LLM + MCP tools for the authenticated company ──
  const nova = getAgentInstance('nova');
  if (!nova) throw new Error('Nova coworker is not initialized');

  const openTask = redisCtx.workingSet?.taskState;
  const resumingContinue = isContinueMessage(message)
    && openTask
    && ['in_progress', 'waiting_continue'].includes(String(openTask.status || ''));

  let planBlock = '';
  let continueBlock = '';
  let executionPlan = null;
  const wantPlan =
    config.coworker?.executionPlan !== false
    && options.skipExecutionPlan !== true
    && !resumingContinue;

  if (resumingContinue) {
    continueBlock = [
      '[Resume task]',
      `Goal: ${openTask.goal || 'open task'}`,
      `Status: ${openTask.status}`,
      Array.isArray(openTask.next) && openTask.next.length
        ? `Next: ${openTask.next.slice(0, 5).join('; ')}`
        : '',
      'Continue without re-planning. Use prior tool results in conversation history. Ask only if truly ambiguous.',
    ].filter(Boolean).join('\n');
    setStatus('Continuing your request…');
    sse({
      type: 'task_progress',
      status: 'resuming',
      goal: openTask.goal || null,
    });
    await saveContext(ctxRef, {
      ...redisCtx,
      workingSet: mergeWorkingSet(redisCtx.workingSet, {
        taskState: { ...openTask, status: 'in_progress', updatedAt: Date.now() },
      }),
    });
  }

  if (wantPlan) {
    setStatus(STATUS_LABEL_PLANNING);
    try {
      executionPlan = await getExecutionPlan({
        message,
        conversationContext: contextPrompt,
        priorMessages,
        usageMeta,
      });
    } catch (err) {
      console.warn('⚠️ Execution plan failed; continuing without plan:', err?.message || err);
      executionPlan = null;
    }

    if (executionPlan?.mode === 'clarify' && executionPlan.ask) {
      const askText = executionPlan.ask;
      if (stopActivityKeywords) {
        stopActivityKeywords();
        stopActivityKeywords = null;
      }
      sse({ type: 'plan', plan: executionPlan });
      sse({ type: 'agent_selected', agent: 'nova' });
      if (options.streamFormatter) {
        sse({ type: 'text', content: askText });
      }
      await persistConversation({
        company_id,
        user_id,
        conversation_id: convId,
        priorMessages,
        message,
        assistantContent: askText,
        toolsUsed: [],
        conversation_summary: convState.conversation_summary,
        summary_through_turn: convState.summary_through_turn,
        requestId,
        plan: executionPlan,
        agentKey: 'nova',
        agents: ['nova'],
        status: 'plan_clarify',
        mode: 'coworker',
      });
      await saveContext(ctxRef, {
        ...redisCtx,
        workingSet: mergeWorkingSet(redisCtx.workingSet, {
          executionPlan,
          sessionGoal: executionPlan.goal || redisCtx.workingSet?.sessionGoal,
        }),
      });
      sse({ type: 'done', agent: 'nova', toolsUsed: [], plan_clarify: true });
      return {
        conversation_id: convId,
        type: 'plan_clarify',
        response: askText,
        formattedText: askText,
        plan: executionPlan,
        toolsUsed: [],
      };
    }

    if (executionPlan?.mode === 'execute') {
      planBlock = formatExecutionPlanForPrompt(executionPlan);
      sse({ type: 'plan', plan: executionPlan });
      const taskState = planToTaskState(executionPlan);
      await saveContext(ctxRef, {
        ...redisCtx,
        workingSet: mergeWorkingSet(redisCtx.workingSet, {
          executionPlan,
          taskState,
          sessionGoal: executionPlan.goal || message.slice(0, 200),
        }),
      });
    }
  }

  // Managed conversation window (same pattern as ChatGPT/Claude tool chat).
  const orchestratorHistory = buildOrchestratorMessages({
    priorMessages,
    currentUserContent: '',
    systemPrompt: nova.systemPrompt || '',
  });
  if (priorMessages.length > 0) {
    logContextUsage('Coworker context', orchestratorHistory, nova.systemPrompt);
  }

  const orchContextPrompt = [contextPrompt, planBlock, continueBlock].filter(Boolean).join('\n\n');

  const orchRunContext = {
    _conversationHistory: orchestratorHistory,
    _planRef: planRef,
    _approvedConfirmations: options.approvedConfirmations || [],
    _skipWriteConfirm: options.skipWriteConfirm,
    ...tenantRunFields,
  };

  sse({ type: 'agent_selected', agent: 'nova' });
  // Stop turn-level keywords; BaseAgent rotates during each createMessage wait.
  if (stopActivityKeywords) {
    stopActivityKeywords();
    stopActivityKeywords = null;
  }

  const allToolsUsed = [];
  let workflowTree = null;
  const agentStart = Date.now();
  const result = await nova.runWithEvents(
    message,
    {
      _rexRequestId: requestId,
      _conversationContext: orchContextPrompt,
      _streamAssistantText: Boolean(options.streamAssistantText ?? options.streamFormatter),
      _executionPlanText: planBlock || '',
      ...orchRunContext,
    },
    sse,
  );
  if (requestId) rex.agentFinished(requestId, nova.name, Date.now() - agentStart, result.usage ?? null);

  if (result.needsConfirmation) {
    if (stopActivityKeywords) {
      stopActivityKeywords();
      stopActivityKeywords = null;
    }
    sse({
      type: 'done',
      agent: 'nova',
      toolsUsed: [],
      pending_confirmation: true,
      confirmationId: result.confirmationId,
    });
    return {
      conversation_id: convId,
      type: 'pending_confirmation',
      confirmationId: result.confirmationId,
      toolsUsed: [],
    };
  }

  allToolsUsed.push(...(result.toolsUsed || []));
  (result.toolsUsed || []).forEach((t, i) => {
    if (t.name === 'get_workflow_object_tree' && t.success !== false) {
      const payload = result.toolResultPayloads?.[i];
      const tree = payload?.data?.data ?? payload?.data ?? null;
      if (tree && (Array.isArray(tree) ? tree.length > 0 : typeof tree === 'object')) {
        workflowTree = tree;
      }
    }
  });

  await updateContext(ctxRef, 'nova', result.toolsUsed, result.toolResultPayloads, {
    message,
    assistantSummary: result.rawText?.slice(0, 300),
  });

  // Primary LLM owns presentation (no OutputFormatter). Text already streamed
  // when _streamAssistantText was set.
  let formattedForUi = result.rawText || '';
  const alreadyStreamed = Boolean(options.streamAssistantText ?? options.streamFormatter);
  if (!alreadyStreamed && options.streamFormatter && formattedForUi) {
    sse({ type: 'text', content: formattedForUi });
  }

  if (workflowTree && !/<workflow[\s>]/i.test(formattedForUi || '')) {
    const treeJson = JSON.stringify(workflowTree);
    if (treeJson.length <= 60000) {
      const workflowXml = `\n\n<workflow>${treeJson}</workflow>`;
      formattedForUi = `${formattedForUi || ''}${workflowXml}`;
      if (options.streamFormatter) {
        sse({ type: 'text', content: workflowXml });
      }
    }
  }

  await persistConversation({
    company_id,
    user_id,
    conversation_id: convId,
    priorMessages,
    message,
    assistantContent: formattedForUi,
    toolsUsed: allToolsUsed,
    conversation_summary: convState.conversation_summary,
    summary_through_turn: convState.summary_through_turn,
    requestId,
    agentTranscript: result.agentTranscript,
    plan: executionPlan,
    usage: result.usage || null,
    agentKey: 'nova',
    agents: ['nova'],
    status: result.needsContinue ? 'waiting_continue' : 'completed',
    mode: 'coworker',
  });

  await updateContext(ctxRef, 'nova', allToolsUsed, [], {
    message,
    assistantSummary: (formattedForUi || '').slice(0, 500),
  });

  if (result.needsContinue) {
    const latest = await getContext(ctxRef);
    const prevTask = latest.workingSet?.taskState || planToTaskState(executionPlan) || {
      goal: message.slice(0, 200),
      next: [],
      completed: [],
    };
    await saveContext(ctxRef, {
      ...latest,
      workingSet: mergeWorkingSet(latest.workingSet, {
        taskState: {
          ...prevTask,
          status: 'waiting_continue',
          updatedAt: Date.now(),
        },
      }),
    });
    sse({
      type: 'task_progress',
      status: 'waiting_continue',
      goal: prevTask.goal || null,
    });
  } else if (executionPlan?.mode === 'execute' || resumingContinue) {
    const latest = await getContext(ctxRef);
    await saveContext(ctxRef, {
      ...latest,
      workingSet: mergeWorkingSet(latest.workingSet, {
        taskState: {
          ...(latest.workingSet?.taskState || planToTaskState(executionPlan) || {}),
          status: 'done',
          next: [],
          updatedAt: Date.now(),
        },
      }),
    });
  }

  if (stopActivityKeywords) {
    stopActivityKeywords();
    stopActivityKeywords = null;
  }
  sse({
    type: 'done',
    agent: 'nova',
    toolsUsed: allToolsUsed.map((t) => t.name),
    ...(executionPlan ? { plan: executionPlan } : {}),
    ...(result.needsContinue ? { waiting_continue: true } : {}),
  });

  return {
    conversation_id: convId,
    type: 'coworker',
    response: formattedForUi,
    formattedText: formattedForUi,
    plan: executionPlan || undefined,
    toolsUsed: allToolsUsed,
    agents: ['nova'],
    ...(result.needsContinue ? { waiting_continue: true } : {}),
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
  await deleteConversationTurns(company_id, user_id, conversation_id);
  await clearContext({ company_id, user_id, conversation_id });
  await clearPlanState({ company_id, user_id, conversation_id });
  await clearPendingConfirm({ company_id, user_id, conversation_id });
}
