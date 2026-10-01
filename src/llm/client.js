/**
 * OpenAI-compatible LLM client (vLLM / self-hosted gpt-oss, etc.).
 * Uses fetch (no openai package) so we stay compatible with zod v4.
 * Callers keep Anthropic-shaped params + responses; conversion is in messageAdapter.
 */

import { config } from '../config/index.js';
import { recordUsageAsync } from '../analytics/recordUsage.js';
import {
  buildOpenAIChatBody,
  fromOpenAICompletion,
  contentToText,
} from './messageAdapter.js';

/**
 * @typedef {object} LlmCallMeta
 * @property {string} [companyId]
 * @property {string} [userId]
 * @property {string} [conversationId]
 * @property {string} [requestId]
 * @property {string} [phase]
 * @property {string} [agentKey]
 * @property {string} [model]
 */

function chatCompletionsUrl() {
  const base = (config.llm.baseUrl || '').replace(/\/$/, '');
  return `${base}/chat/completions`;
}

function authHeaders() {
  const key = config.llm.apiKey || 'not-needed';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

/**
 * @param {object} body
 * @param {{ stream?: boolean }} [opts]
 */
async function postChat(body, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs || 120000);
  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `LLM HTTP ${res.status} from ${chatCompletionsUrl()}: ${errText.slice(0, 500)}`,
      );
    }
    if (opts.stream) return res;
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {object} params - Anthropic-shaped MessageCreateParams
 * @param {LlmCallMeta} [meta]
 */
export async function createMessage(params, meta = {}) {
  const body = buildOpenAIChatBody(params, config.llm.model);
  let lastErr;
  const retries = Math.max(0, config.llm.maxRetries ?? 1);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await postChat({ ...body, stream: false });
      const message = fromOpenAICompletion(completion);
      recordUsageAsync(meta, message.usage, body.model || config.llm.model);
      return message;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
    }
  }
  throw lastErr;
}

/**
 * Stream chat completion; calls onTextDelta for text chunks.
 * Returns Anthropic-shaped final message.
 *
 * @param {object} params
 * @param {LlmCallMeta} [meta]
 * @param {(delta: string) => void} [onTextDelta]
 * @returns {Promise<{ text: string, message: object }>}
 */
export async function streamMessage(params, meta = {}, onTextDelta = () => {}) {
  const body = buildOpenAIChatBody(params, config.llm.model);
  const res = await postChat({ ...body, stream: true }, { stream: true });

  let text = '';
  let finishReason = 'stop';
  /** @type {Map<number, { id: string, name: string, arguments: string }>} */
  const toolAcc = new Map();
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('LLM stream response has no body');
  }
  const decoder = new TextDecoder();
  let buffer = '';

  const pushText = (piece) => {
    if (!piece) return;
    text += piece;
    onTextDelta(piece);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) {
        usage = {
          input_tokens: Number(chunk.usage.prompt_tokens) || 0,
          output_tokens: Number(chunk.usage.completion_tokens) || 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      // Prefer delta.content; some backends only send choice.message on the final chunk.
      const deltaText = contentToText(delta.content);
      if (deltaText) {
        pushText(deltaText);
      } else if (!text && choice.message) {
        const finalText = contentToText(choice.message.content);
        if (finalText) pushText(finalText);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) || { id: '', name: '', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      }
    }
  }

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const tc of toolAcc.values()) {
    let input = {};
    try {
      input = JSON.parse(tc.arguments || '{}');
    } catch {
      input = { _raw: tc.arguments || '' };
    }
    content.push({
      type: 'tool_use',
      id: tc.id || `tool_${Date.now()}`,
      name: tc.name,
      input,
    });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  let stop_reason = 'end_turn';
  if (finishReason === 'tool_calls' || toolAcc.size > 0) stop_reason = 'tool_use';
  else if (finishReason === 'length') stop_reason = 'max_tokens';

  const message = {
    id: '',
    type: 'message',
    role: 'assistant',
    content,
    stop_reason,
    usage,
  };

  recordUsageAsync(meta, usage, body.model || config.llm.model);
  return { text, message };
}
