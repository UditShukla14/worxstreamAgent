/**
 * Conversation history helpers — load MongoDB transcripts and shape them
 * for orchestrator (full window) vs specialist (short recent window).
 */

import { config } from '../config/index.js';
import {
  applySlidingWindow,
  manageContextWindow,
  truncateByTokens,
  getContextStats,
} from './contextWindow.js';
import { sanitizeTranscriptMessageForApi } from '../nova/agents/agentTranscript.js';

const VALID_ROLES = new Set(['user', 'assistant']);

/**
 * Normalize stored Mongo message content to a plain string for Anthropic.
 */
export function messageContentToString(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text' && block.text) return String(block.text);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

/**
 * Render a stored compact tool transcript (see persistConversation) so later
 * turns know what was already called, what worked, and what failed —
 * preventing repeated lookups and repeated known-bad calls.
 */
function renderToolActivity(activity) {
  if (!Array.isArray(activity) || activity.length === 0) return '';
  const lines = activity.map((a) => {
    const outcome = a.ok ? 'ok' : `FAILED: ${a.error || 'error'}`;
    return `- ${a.tool}(${a.input || '{}'}) → ${outcome}`;
  });
  return `\n\n[Tools used this turn]\n${lines.join('\n')}`;
}

/**
 * Expand Mongo messages into Anthropic history.
 * Prefer agent_transcript (tool_use / tool_result / raw text) when present;
 * fall back to UI content + compact tool_activity for older turns.
 *
 * @param {Array<{ role: string, content: unknown, tool_activity?: object[], agent_transcript?: object[] }>} stored
 * @returns {Array<{ role: 'user' | 'assistant', content: string | object[] }>}
 */
export function expandStoredMessagesForAgent(stored) {
  if (!Array.isArray(stored)) return [];

  const out = [];
  for (const m of stored) {
    if (!m || !VALID_ROLES.has(m.role)) continue;

    if (m.role === 'user') {
      const text = messageContentToString(m.content).trim();
      if (text) out.push({ role: 'user', content: text });
      continue;
    }

    // assistant
    if (Array.isArray(m.agent_transcript) && m.agent_transcript.length > 0) {
      for (const tm of m.agent_transcript) {
        const clean = sanitizeTranscriptMessageForApi(tm);
        if (clean) out.push(clean);
      }
      continue;
    }

    const text = messageContentToString(m.content).trim();
    const toolBlock = renderToolActivity(m.tool_activity);
    const combined = `${text}${toolBlock}`.trim();
    if (combined) out.push({ role: 'assistant', content: combined });
  }
  return out;
}

/**
 * @param {Array<{ role: string, content: unknown, tool_activity?: object[] }>} stored
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 * @deprecated Prefer expandStoredMessagesForAgent for orchestrator memory.
 */
export function normalizeStoredMessages(stored) {
  if (!Array.isArray(stored)) return [];

  const out = [];
  for (const m of stored) {
    if (!m || !VALID_ROLES.has(m.role)) continue;
    const text = messageContentToString(m.content).trim();
    if (!text) continue;
    const toolBlock = m.role === 'assistant' ? renderToolActivity(m.tool_activity) : '';
    out.push({ role: m.role, content: text + toolBlock });
  }
  return out;
}

/**
 * Build messages for router / Nova / general chat (full managed window).
 * Uses agent_transcript when available so follow-ups see real tool outputs.
 *
 * @param {object} opts
 * @param {Array} opts.priorMessages - Mongo messages (may include agent_transcript)
 * @param {string} opts.currentUserContent - Full text for this turn's user message
 * @param {string} [opts.systemPrompt]
 * @param {object[]} [opts.tools]
 */
export function buildOrchestratorMessages({
  priorMessages = [],
  currentUserContent,
  systemPrompt = '',
  tools = [],
}) {
  const prior = expandStoredMessagesForAgent(priorMessages);
  const current = String(currentUserContent || '').trim();
  const messages = current
    ? [...prior, { role: 'user', content: current }]
    : [...prior];

  return manageContextWindow(messages, systemPrompt, tools);
}

/**
 * Recent transcript slice for specialist agents (cheaper than full history).
 *
 * @param {Array<{ role: string, content: unknown }>} priorMessages
 * @param {object} [opts]
 * @param {object} [opts.workingSet] - When activeTask in progress, use larger window
 */
export function buildSpecialistHistory(priorMessages = [], opts = {}) {
  // Specialists still use compact text history (cheaper); orchestrator uses full transcript.
  const prior = normalizeStoredMessages(priorMessages);
  if (prior.length === 0) return [];

  const activeInProgress = opts.workingSet?.activeTask?.status === 'in_progress'
    || opts.workingSet?.taskState?.status === 'in_progress';
  const maxMessages = activeInProgress
    ? (config.contextWindow.specialistMessagesActive ?? 12)
    : (config.contextWindow.specialistMaxMessages ?? 6);
  const maxTokens = config.contextWindow.specialistMaxTokens ?? 12000;
  const reserveTokens = config.contextWindow.specialistReserveTokens ?? 4000;

  let messages = applySlidingWindow(prior, maxMessages);
  const available = Math.max(1000, maxTokens - reserveTokens);
  messages = truncateByTokens(messages, available, 0);

  return messages;
}

/**
 * Log context usage (orchestrator vs specialist).
 */
export function logContextUsage(label, messages, systemPrompt = '', tools = []) {
  const stats = getContextStats(messages, systemPrompt, tools);
  console.log(
    `📜 ${label}: ${stats.messageCount} message(s), ~${stats.totalTokens} tokens`
    + ` (cap ${stats.maxTokens})`,
  );
  return stats;
}
