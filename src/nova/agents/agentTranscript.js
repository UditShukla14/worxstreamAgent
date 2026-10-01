/** Compact native OpenAI tool-call transcripts for next-turn memory. */
import { config } from '../../config/index.js';

const DEFAULT_MAX_RESULT_CHARS = 4000;

function maxResultChars() {
  const value = config.coworker?.agentTranscriptMaxResultChars;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_RESULT_CHARS;
}

export function capToolResultContent(content, maxChars = maxResultChars()) {
  let text;
  if (typeof content === 'string') text = content;
  else {
    try { text = JSON.stringify(content); } catch { text = String(content ?? ''); }
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

export function compactTranscriptMessage(message) {
  if (!message || !['assistant', 'tool'].includes(message.role)) return null;
  if (message.role === 'tool') {
    if (!message.tool_call_id) return null;
    return {
      role: 'tool',
      tool_call_id: String(message.tool_call_id),
      content: capToolResultContent(message.content),
    };
  }

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
      .filter((call) => call?.id && call?.function?.name)
      .map((call) => ({
        id: String(call.id),
        type: 'function',
        function: {
          name: String(call.function.name),
          arguments: typeof call.function.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function.arguments || {}),
        },
      }))
    : [];
  if (!content && toolCalls.length === 0) return null;
  return {
    role: 'assistant',
    content: content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

export function extractTurnAgentTranscript(allMessages, historyLength = 0) {
  if (!Array.isArray(allMessages) || allMessages.length === 0) return [];
  const turn = allMessages.slice(Math.max(0, Number(historyLength) || 0));
  const withoutPrompt = turn[0]?.role === 'user' ? turn.slice(1) : turn;
  return withoutPrompt.map(compactTranscriptMessage).filter(Boolean);
}

export function sanitizeTranscriptMessageForApi(message) {
  return compactTranscriptMessage(message);
}
