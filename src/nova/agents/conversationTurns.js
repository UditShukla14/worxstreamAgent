/**
 * Conversation turn store — professional turn-by-turn transcript + logs in Mongo.
 */

import { randomUUID } from 'crypto';
import ConversationTurn from '../models/ConversationTurn.js';

/**
 * @param {object} params
 * @param {string} params.company_id
 * @param {string} params.user_id
 * @param {string} params.conversation_id
 * @param {string} params.userContent
 * @param {string} [params.uiContent]
 * @param {object[]} [params.agentTranscript]
 * @param {object[]} [params.toolsUsed]
 * @param {object|null} [params.plan]
 * @param {object|null} [params.usage]
 * @param {string} [params.agentKey]
 * @param {string[]} [params.agents]
 * @param {string} [params.status]
 * @param {string} [params.mode]
 * @param {string} [params.requestId]
 * @param {number} [params.turnIndex] - If omitted, appends as next index
 * @returns {Promise<object|null>}
 */
export async function appendConversationTurn({
  company_id,
  user_id,
  conversation_id,
  userContent,
  uiContent = '',
  agentTranscript = [],
  toolsUsed = [],
  plan = null,
  usage = null,
  agentKey = 'nova',
  agents = null,
  status = 'completed',
  mode = 'orchestrator',
  requestId = null,
  turnIndex = null,
}) {
  if (!company_id || !user_id || !conversation_id) return null;

  let index = turnIndex;
  if (index == null || !Number.isFinite(index)) {
    const last = await ConversationTurn.findOne({ company_id, user_id, conversation_id })
      .sort({ turn_index: -1 })
      .select('turn_index')
      .lean();
    index = last?.turn_index != null ? last.turn_index + 1 : 0;
  }

  const tools = Array.isArray(toolsUsed) && toolsUsed.length > 0
    ? toolsUsed.slice(-20).map((t) => ({
      tool: t.name || t.tool,
      input: typeof t.input === 'string' ? t.input.slice(0, 200) : JSON.stringify(t.input ?? {}).slice(0, 200),
      ok: t.success !== false && t.ok !== false,
      ...(t.error || t.success === false ? { error: String(t.error || 'error').slice(0, 300) } : {}),
    }))
    : undefined;

  const doc = {
    company_id,
    user_id,
    conversation_id,
    turn_index: index,
    turn_id: randomUUID(),
    request_id: requestId || null,
    user: { content: userContent, at: new Date() },
    ui: { content: uiContent || '' },
    transcript: Array.isArray(agentTranscript) ? agentTranscript : [],
    log: {
      status: status || 'completed',
      mode: mode || 'orchestrator',
      agent_key: agentKey || 'nova',
      ...(agents?.length ? { agents } : {}),
      ...(plan ? { plan } : {}),
      ...(tools ? { tools } : {}),
      ...(usage ? { usage } : {}),
    },
  };

  try {
    const saved = await ConversationTurn.findOneAndUpdate(
      { company_id, user_id, conversation_id, turn_index: index },
      { $set: doc },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return saved;
  } catch (err) {
    console.warn('⚠️ Failed to append ConversationTurn:', err?.message || err);
    return null;
  }
}

/**
 * @param {string} company_id
 * @param {string} user_id
 * @param {string} conversation_id
 * @returns {Promise<object[]>}
 */
export async function listConversationTurns(company_id, user_id, conversation_id) {
  if (!company_id || !user_id || !conversation_id) return [];
  try {
    return await ConversationTurn.find({ company_id, user_id, conversation_id })
      .sort({ turn_index: 1 })
      .lean();
  } catch (err) {
    console.warn('⚠️ Failed to list ConversationTurns:', err?.message || err);
    return [];
  }
}

/**
 * Map turns → Mongo message shape used by expandStoredMessagesForAgent.
 * Prefer transcript from turns; UI content for display fallbacks.
 *
 * @param {object[]} turns
 * @returns {Array<{ role: string, content: unknown, agent_transcript?: object[], tool_activity?: object[] }>}
 */
export function turnsToPriorMessages(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return [];

  const out = [];
  for (const t of turns) {
    const userText = t?.user?.content;
    if (userText != null && String(userText).length > 0) {
      out.push({ role: 'user', content: userText });
    }
    const tools = Array.isArray(t?.log?.tools)
      ? t.log.tools.map((x) => ({
        tool: x.tool,
        input: x.input || '{}',
        ok: x.ok !== false,
        ...(x.error ? { error: x.error } : {}),
      }))
      : undefined;
    out.push({
      role: 'assistant',
      content: t?.ui?.content ?? '',
      ...(Array.isArray(t?.transcript) && t.transcript.length > 0
        ? { agent_transcript: t.transcript }
        : {}),
      ...(tools ? { tool_activity: tools } : {}),
    });
  }
  return out;
}

/**
 * Public API shape: logs without huge transcript blobs (optional include).
 * @param {object} turn
 * @param {{ includeTranscript?: boolean }} [opts]
 */
export function turnToApi(turn, opts = {}) {
  if (!turn) return null;
  const base = {
    turn_id: turn.turn_id,
    turn_index: turn.turn_index,
    request_id: turn.request_id,
    user: turn.user,
    ui: turn.ui,
    log: turn.log,
    created_at: turn.created_at,
    updated_at: turn.updated_at,
  };
  if (opts.includeTranscript) {
    base.transcript = turn.transcript || [];
  }
  return base;
}

/**
 * @param {string} company_id
 * @param {string} user_id
 * @param {string} conversation_id
 */
export async function deleteConversationTurns(company_id, user_id, conversation_id) {
  if (!company_id || !user_id || !conversation_id) return;
  try {
    await ConversationTurn.deleteMany({ company_id, user_id, conversation_id });
  } catch (err) {
    console.warn('⚠️ Failed to delete ConversationTurns:', err?.message || err);
  }
}
