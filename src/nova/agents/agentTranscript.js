/**
 * Agent turn transcript — persist tool_use / tool_result for next-turn memory
 * (Claude/OpenAI-style), without feeding UI formatter XML back as agent history.
 */

import { config } from '../../config/index.js';

const DEFAULT_MAX_RESULT_CHARS = 4000;

function maxResultChars() {
  const n = config.coworker?.agentTranscriptMaxResultChars;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RESULT_CHARS;
}

/**
 * Cap a tool_result content string so list payloads do not blow the context window.
 * @param {unknown} content
 * @param {number} [maxChars]
 * @returns {string}
 */
export function capToolResultContent(content, maxChars = maxResultChars()) {
  let text;
  if (typeof content === 'string') text = content;
  else {
    try {
      text = JSON.stringify(content);
    } catch {
      text = String(content ?? '');
    }
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

/**
 * Compact one Anthropic message for Mongo storage.
 * @param {object} msg
 * @returns {object|null}
 */
export function compactTranscriptMessage(msg) {
  if (!msg || (msg.role !== 'assistant' && msg.role !== 'user')) return null;

  if (typeof msg.content === 'string') {
    const t = msg.content.trim();
    return t ? { role: msg.role, content: t } : null;
  }

  if (!Array.isArray(msg.content)) return null;

  const blocks = [];
  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      const text = String(block.text || '').trim();
      if (text) blocks.push({ type: 'text', text });
      continue;
    }
    if (block.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input && typeof block.input === 'object' ? block.input : {},
      });
      continue;
    }
    if (block.type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: capToolResultContent(block.content),
        ...(block.is_error ? { is_error: true } : {}),
      });
    }
  }

  if (blocks.length === 0) return null;
  return { role: msg.role, content: blocks };
}

/**
 * From the live BaseAgent messages array, extract this turn only (after prior history),
 * drop the fat turn-prompt user message, keep tool loop + final assistant text (capped).
 *
 * @param {object[]} allMessages - Full messages array used in the LLM loop
 * @param {number} historyLength - Length of `_conversationHistory` at turn start
 * @returns {object[]}
 */
export function extractTurnAgentTranscript(allMessages, historyLength = 0) {
  if (!Array.isArray(allMessages) || allMessages.length === 0) return [];

  const start = Math.max(0, Number(historyLength) || 0);
  const turn = allMessages.slice(start);
  // First message is usually the user turn prompt (context + request) — skip it;
  // the plain user text is stored separately on the Conversation user message.
  const withoutTurnPrompt =
    turn.length > 0 && turn[0]?.role === 'user' ? turn.slice(1) : turn;

  const out = [];
  for (const msg of withoutTurnPrompt) {
    const compact = compactTranscriptMessage(msg);
    if (compact) out.push(compact);
  }
  return out;
}

/**
 * Sanitize a stored transcript message for the next Anthropic call.
 * @param {object} msg
 * @returns {object|null}
 */
export function sanitizeTranscriptMessageForApi(msg) {
  return compactTranscriptMessage(msg);
}
