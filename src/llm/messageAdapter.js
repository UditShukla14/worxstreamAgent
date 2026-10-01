/**
 * Convert between Anthropic-shaped agent messages/tools (used in BaseAgent,
 * transcripts) and OpenAI chat.completions payloads (vLLM / gpt-oss).
 */

import { randomUUID } from 'crypto';

/** Anthropic-native tool search — not supported on OpenAI-compatible backends. */
const ANTHROPIC_ONLY_TOOL_NAMES = new Set([
  'tool_search_tool_bm25',
  'tool_search_tool_bm25_20251119',
  'tool_search_tool_regex',
]);

/**
 * @param {Array<{ name: string, description?: string, input_schema?: object, defer_loading?: boolean }>|undefined} tools
 * @returns {Array<{ type: 'function', function: { name: string, description: string, parameters: object } }>}
 */
export function toOpenAITools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const out = [];
  for (const t of tools) {
    if (!t?.name || ANTHROPIC_ONLY_TOOL_NAMES.has(t.name)) continue;
    if (t.type === 'function' && t.function?.name) {
      out.push(t);
      continue;
    }
    out.push({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || t.name,
        parameters: t.input_schema || t.parameters || {
          type: 'object',
          properties: {},
        },
      },
    });
  }
  return out;
}

/**
 * @param {{ type?: string }|string|undefined} toolChoice
 * @returns {'auto'|'none'|object|undefined}
 */
export function toOpenAIToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'none') return 'none';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    };
  }
  return 'auto';
}

/**
 * Flatten Anthropic content blocks / OpenAI content to a string when needed.
 * @param {unknown} content
 */
function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== 'object') return '';
        if (b.type === 'text') return String(b.text || '');
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content);
}

/**
 * @param {string|undefined} system
 * @param {Array<{ role: string, content: unknown }>|undefined} messages
 * @returns {Array<{ role: string, content?: string|null, tool_calls?: object[], tool_call_id?: string }>}
 */
export function toOpenAIMessages(system, messages) {
  const out = [];
  if (system && String(system).trim()) {
    out.push({ role: 'system', content: String(system) });
  }

  for (const msg of messages || []) {
    if (!msg || !msg.role) continue;
    const role = msg.role;
    const content = msg.content;

    if (role === 'system') {
      const text = contentToText(content);
      if (text) out.push({ role: 'system', content: text });
      continue;
    }

    if (role === 'user') {
      if (typeof content === 'string') {
        out.push({ role: 'user', content });
        continue;
      }
      if (Array.isArray(content)) {
        const toolResults = content.filter((b) => b && b.type === 'tool_result');
        const texts = content.filter((b) => b && b.type === 'text');
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            const body =
              typeof tr.content === 'string'
                ? tr.content
                : JSON.stringify(tr.content ?? '');
            out.push({
              role: 'tool',
              tool_call_id: String(tr.tool_use_id || ''),
              content: body,
            });
          }
          const text = texts.map((t) => t.text || '').filter(Boolean).join('\n');
          if (text) out.push({ role: 'user', content: text });
          continue;
        }
        out.push({ role: 'user', content: contentToText(content) || '' });
        continue;
      }
      out.push({ role: 'user', content: contentToText(content) });
      continue;
    }

    if (role === 'assistant') {
      if (typeof content === 'string') {
        out.push({ role: 'assistant', content });
        continue;
      }
      if (Array.isArray(content)) {
        const textParts = [];
        const toolCalls = [];
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && block.text) {
            textParts.push(String(block.text));
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: String(block.id || `tool_${randomUUID()}`),
              type: 'function',
              function: {
                name: String(block.name || ''),
                arguments: JSON.stringify(block.input ?? {}),
              },
            });
          }
        }
        const assistantMsg = {
          role: 'assistant',
          content: textParts.length ? textParts.join('\n') : null,
        };
        if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
        out.push(assistantMsg);
        continue;
      }
      out.push({ role: 'assistant', content: contentToText(content) });
      continue;
    }

    if (role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: String(msg.tool_call_id || msg.tool_use_id || ''),
        content:
          typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      });
    }
  }

  return out;
}

/**
 * @param {object} completion - OpenAI chat.completion response
 * @returns {{
 *   id: string,
 *   type: 'message',
 *   role: 'assistant',
 *   content: Array<object>,
 *   stop_reason: 'tool_use'|'end_turn'|'max_tokens'|string,
 *   usage: { input_tokens: number, output_tokens: number },
 * }}
 */
export function fromOpenAICompletion(completion) {
  const choice = completion?.choices?.[0];
  const message = choice?.message || {};
  const content = [];

  if (message.content) {
    content.push({ type: 'text', text: String(message.content) });
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const tc of toolCalls) {
    let input = {};
    try {
      input = JSON.parse(tc.function?.arguments || '{}');
    } catch {
      input = { _raw: tc.function?.arguments || '' };
    }
    content.push({
      type: 'tool_use',
      id: String(tc.id || `tool_${randomUUID()}`),
      name: String(tc.function?.name || ''),
      input,
    });
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  let stop_reason = 'end_turn';
  const fr = choice?.finish_reason;
  if (fr === 'tool_calls' || toolCalls.length > 0) stop_reason = 'tool_use';
  else if (fr === 'length') stop_reason = 'max_tokens';
  else if (fr === 'stop' || fr === 'end_turn') stop_reason = 'end_turn';

  const usage = completion?.usage || {};
  return {
    id: String(completion?.id || ''),
    type: 'message',
    role: 'assistant',
    model: completion?.model,
    content,
    stop_reason,
    usage: {
      input_tokens: Number(usage.prompt_tokens) || 0,
      output_tokens: Number(usage.completion_tokens) || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/**
 * Build OpenAI chat.completions body from Anthropic-shaped agent params.
 * @param {object} params
 * @param {string} defaultModel
 */
export function buildOpenAIChatBody(params, defaultModel) {
  const model = params.model || defaultModel;
  const body = {
    model,
    messages: toOpenAIMessages(params.system, params.messages),
    max_tokens: params.max_tokens,
  };
  if (params.temperature != null) body.temperature = params.temperature;

  const tools = toOpenAITools(params.tools);
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toOpenAIToolChoice(params.tool_choice) ?? 'auto';
  }
  return body;
}
