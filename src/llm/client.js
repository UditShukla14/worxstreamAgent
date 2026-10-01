/** Native OpenAI Chat Completions client for the hosted model. */
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { recordUsageAsync } from '../analytics/recordUsage.js';
import { sanitizeOpenAIMessages } from '../utils/validateMessages.js';

function normalizeCompletion(completion) {
  const message = completion?.choices?.[0]?.message;
  if (!message || !Array.isArray(message.tool_calls)) return completion;
  message.tool_calls = message.tool_calls.map((call) => ({
    ...call,
    id: call.id || `call_${randomUUID()}`,
    type: 'function',
    function: {
      ...call.function,
      arguments: typeof call.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments || {}),
    },
  }));
  return completion;
}

function chatCompletionsUrl() {
  return `${String(config.llm.baseUrl || '').replace(/\/$/, '')}/chat/completions`;
}

async function postChat(body, { stream = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs || 120000);
  try {
    const response = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey || 'not-needed'}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`LLM HTTP ${response.status} from ${chatCompletionsUrl()}: ${detail.slice(0, 500)}`);
    }
    return stream ? response : response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function buildChatCompletionBody(params) {
  const body = {
    ...params,
    model: params.model || config.llm.model,
    messages: sanitizeOpenAIMessages(params.messages),
  };
  if (!body.tools?.length) {
    delete body.tools;
    delete body.tool_choice;
    delete body.parallel_tool_calls;
  }
  return body;
}

export function getAssistantMessage(completion) {
  return completion?.choices?.[0]?.message || { role: 'assistant', content: '' };
}

export function getResponseText(completion) {
  const content = getAssistantMessage(completion).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => part?.type === 'text' ? String(part.text || '') : '').join('');
}

export async function createMessage(params, meta = {}) {
  const body = buildChatCompletionBody(params);
  let lastError;
  const retries = Math.max(0, config.llm.maxRetries ?? 1);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = normalizeCompletion(await postChat({ ...body, stream: false }));
      recordUsageAsync(meta, completion.usage, completion.model || body.model);
      return completion;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
    }
  }
  throw lastError;
}

export async function streamMessage(params, meta = {}, onTextDelta = () => {}) {
  const body = buildChatCompletionBody(params);
  const response = await postChat({
    ...body,
    stream: true,
    stream_options: { include_usage: true },
  }, { stream: true });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('LLM stream response has no body');

  let text = '';
  let finishReason = 'stop';
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finalMessage = null;
  const calls = new Map();
  const decoder = new TextDecoder();
  let buffer = '';

  const appendCall = (call, fallbackIndex = 0) => {
    if (!call) return;
    const index = call.index ?? fallbackIndex;
    const current = calls.get(index) || {
      id: '', type: 'function', function: { name: '', arguments: '' },
    };
    if (call.id) current.id = call.id;
    if (call.function?.name) {
      const piece = call.function.name;
      if (!current.function.name || piece.startsWith(current.function.name)) current.function.name = piece;
      else if (piece !== current.function.name) current.function.name += piece;
    }
    if (call.function?.arguments != null) {
      const piece = call.function.arguments;
      if (typeof piece === 'object') current.function.arguments = JSON.stringify(piece);
      else {
        const previous = typeof current.function.arguments === 'string' ? current.function.arguments : '';
        current.function.arguments = piece.startsWith(previous) ? piece : previous + piece;
      }
    }
    calls.set(index, current);
  };

  const processData = (data) => {
    if (!data || data === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onTextDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((call, index) => appendCall(call, index));
    }
    if (choice.message) finalMessage = choice.message;
  };
  const processLine = (raw) => {
    const line = raw.trim();
    if (line.startsWith('data:')) processData(line.slice(5).trim());
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(processLine);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);

  if (!text && typeof finalMessage?.content === 'string') {
    text = finalMessage.content;
    if (text) onTextDelta(text);
  }
  if (calls.size === 0 && Array.isArray(finalMessage?.tool_calls)) {
    finalMessage.tool_calls.forEach((call, index) => appendCall(call, index));
  }

  const completion = normalizeCompletion({
    id: '', object: 'chat.completion', model: body.model,
    choices: [{
      index: 0,
      finish_reason: calls.size > 0 ? 'tool_calls' : finishReason,
      message: {
        role: 'assistant',
        content: text || null,
        ...(calls.size > 0 ? { tool_calls: [...calls.values()] } : {}),
      },
    }],
    usage,
  });
  recordUsageAsync(meta, usage, body.model);
  return { text, completion };
}
