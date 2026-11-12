/**
 * Context Window Manager
 * Manages conversation context using sliding window approach
 */

import { countMessageTokens, countMessagesTokens, estimateContextSize, countToolsTokens, countTokens } from './tokenCounter.js';
import { config } from '../config/index.js';
import { computeContextBudget } from './contextBudget.js';

/**
 * Apply sliding window to messages array
 * Keeps only the most recent N messages, preserving message pairs when possible
 */
export function applySlidingWindow(messages, maxMessages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const max = maxMessages || config.contextWindow.maxMessages || 50;

  // If we have fewer messages than the limit, return all
  if (messages.length <= max) {
    return messages;
  }

  // Keep only the most recent messages
  const truncated = messages.slice(-max);

  // Try to preserve message pairs (user + assistant)
  // If the first message is an assistant message without a preceding user message,
  // we might want to remove it, but for simplicity, we'll just keep the last N messages
  // This ensures we always have complete conversation context

  return truncated;
}

/**
 * Truncate messages based on token limit
 * Removes oldest messages until we're within the token limit
 */
export function truncateByTokens(messages, maxTokens, reserveTokens = 0) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const availableTokens = maxTokens - reserveTokens;
  let currentTokens = countMessagesTokens(messages);

  // If we're within the limit, return all messages
  if (currentTokens <= availableTokens) {
    return messages;
  }

  // Drop oldest messages until within the limit (single pass, no recount per removal).
  let drop = 0;
  while (drop < messages.length && currentTokens > availableTokens) {
    currentTokens -= countMessageTokens(messages[drop]);
    drop++;
  }
  const truncated = messages.slice(drop);

  return truncated;
}

/** A plain user text message opens a turn; tool_result carriers (array content) do not. */
function opensTurn(msg) {
  return msg?.role === 'user' && typeof msg.content === 'string';
}

/**
 * Group a flat Anthropic message list into turns:
 *   user text → (assistant tool_use → user tool_result)* → assistant answer.
 * Windowing in whole turns guarantees tool_use / tool_result pairs never split.
 * Leading messages that do not belong to a user-opened turn are discarded.
 * @param {Array<{role: string, content: string|object[]}>} messages
 * @returns {Array<Array<object>>}
 */
export function groupIntoTurns(messages) {
  const turns = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (opensTurn(msg)) turns.push([msg]);
    else if (turns.length > 0) turns[turns.length - 1].push(msg);
  }
  return turns;
}

/**
 * Keep the newest whole turns that fit `budgetTokens` (always at least the
 * newest turn). Linear: each message is counted once.
 * @returns {{ messages: object[], droppedTurns: number, keptTurns: number, tokens: number }}
 */
export function fitTurnsToBudget(messages, budgetTokens, { maxMessages = 0 } = {}) {
  const turns = groupIntoTurns(messages);
  if (turns.length === 0) return { messages: [], droppedTurns: 0, keptTurns: 0, tokens: 0 };

  const sizes = turns.map((t) => countMessagesTokens(t));
  let kept = 0;
  let tokens = 0;
  let count = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const over = tokens + sizes[i] > budgetTokens || (maxMessages > 0 && count + turns[i].length > maxMessages);
    if (over && kept > 0) break;
    tokens += sizes[i];
    count += turns[i].length;
    kept++;
  }
  const keptTurns = turns.slice(turns.length - kept);
  return {
    messages: keptTurns.flat(),
    droppedTurns: turns.length - kept,
    keptTurns: kept,
    tokens,
  };
}

/**
 * Plan the history window for one call against a per-model budget.
 *
 *   history budget = usable − (system + tools + extra per-turn text)
 *
 * @param {object} opts
 * @param {Array} opts.messages
 * @param {string} [opts.systemPrompt]
 * @param {object[]} [opts.tools]
 * @param {string} [opts.extraText]       - per-turn context block appended outside history
 * @param {string} [opts.model]
 * @param {number} [opts.reservedOutput]
 */
export function planContextWindow({
  messages,
  systemPrompt = '',
  tools = [],
  extraText = '',
  model,
  reservedOutput,
}) {
  const budget = computeContextBudget({ model, reservedOutput });
  const fixed = countTokens(String(systemPrompt || ''))
    + countToolsTokens(tools)
    + countTokens(String(extraText || ''))
    + 100;
  const historyBudget = Math.max(2_000, budget.usable - fixed);
  const fit = fitTurnsToBudget(messages, historyBudget, {
    maxMessages: config.contextWindow.maxMessages || 0,
  });
  return {
    ...fit,
    budget,
    fixedTokens: fixed,
    historyBudget,
    overSoft: fit.tokens + fixed > budget.soft,
  };
}

const CLEARED_NOTE = '[tool result cleared to save context — call the tool again if you need it]';

/**
 * Client-side context editing: replace the bodies of all but the most recent
 * `keepRecent` tool-result messages with a short stub. Pairing (tool_use_id) is
 * preserved. Pure — never mutates the input (the live array is persisted as the
 * turn transcript).
 * @param {Array} messages
 * @param {{ keepRecent?: number }} [opts]
 * @returns {{ messages: Array, cleared: number }}
 */
export function clearOldToolResults(messages, { keepRecent = 2 } = {}) {
  const carriers = [];
  messages.forEach((m, i) => {
    if (m?.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result')) {
      carriers.push(i);
    }
  });
  const stale = new Set(carriers.slice(0, Math.max(0, carriers.length - keepRecent)));
  if (stale.size === 0) return { messages, cleared: 0 };
  let cleared = 0;
  const out = messages.map((m, i) => {
    if (!stale.has(i)) return m;
    return {
      ...m,
      content: m.content.map((b) => {
        if (b?.type !== 'tool_result' || b.content === CLEARED_NOTE) return b;
        cleared++;
        return { ...b, content: CLEARED_NOTE };
      }),
    };
  });
  return { messages: out, cleared };
}

/**
 * Manage context window — turn-aware, token-budgeted per model.
 * Returns the messages to send.
 */
export function manageContextWindow(messages, systemPrompt = '', tools = [], opts = {}) {
  if (!Array.isArray(messages)) return [];
  return planContextWindow({ messages, systemPrompt, tools, ...opts }).messages;
}

/**
 * Get context statistics for logging
 */
export function getContextStats(messages, systemPrompt = '', tools = []) {
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const messageTokens = countMessagesTokens(messages);
  const systemTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
  const toolsTokens = countToolsTokens(tools);
  const totalTokens = estimateContextSize(systemPrompt, messages, tools);

  return {
    messageCount,
    messageTokens,
    systemTokens,
    toolsTokens,
    totalTokens,
    maxMessages: config.contextWindow.maxMessages || 0,
    maxTokens: config.contextWindow.maxTokens || 200000,
    reserveTokens: config.contextWindow.reserveTokens || 10000,
  };
}

