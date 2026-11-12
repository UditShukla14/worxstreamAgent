/**
 * Shared Anthropic client — every Messages API call records official usage.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { recordUsageAsync } from '../analytics/recordUsage.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

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

/**
 * @param {import('@anthropic-ai/sdk').Anthropic.MessageCreateParams} params
 * @param {LlmCallMeta} [meta]
 * @param {{ signal?: AbortSignal }} [requestOptions] forwarded to the SDK (abort support)
 * @returns {Promise<import('@anthropic-ai/sdk').Anthropic.Message>}
 */
export async function createMessage(params, meta = {}, requestOptions = undefined) {
  const response = requestOptions
    ? await client.messages.create(params, requestOptions)
    : await client.messages.create(params);
  recordUsageAsync(meta, response.usage, params.model || config.anthropic.model, response.model, { messageId: response.id });
  return response;
}

/**
 * Stream a message; yields SDK stream events. Records usage from finalMessage().
 *
 * @param {import('@anthropic-ai/sdk').Anthropic.MessageStreamParams} params
 * @param {LlmCallMeta} [meta]
 * @param {(delta: string, blockIndex: number) => void} [onTextDelta]
 * @param {{ signal?: AbortSignal }} [requestOptions] forwarded to the SDK (abort support)
 * @param {{ onDelta?: (delta: string, blockIndex: number) => void, onStop?: (blockIndex: number) => void }} [thinking]
 *   receives extended-thinking text as it streams, and a stop signal when each thinking block ends
 * @returns {Promise<{ text: string, message: import('@anthropic-ai/sdk').Anthropic.Message }>}
 */
export async function streamMessage(params, meta = {}, onTextDelta = () => {}, requestOptions = undefined, thinking = undefined) {
  const stream = requestOptions ? client.messages.stream(params, requestOptions) : client.messages.stream(params);
  let text = '';

  const blockTypes = new Map();
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start') blockTypes.set(event.index, event.content_block?.type);
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        onTextDelta(event.delta.text, event.index);
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
        thinking?.onDelta?.(event.delta.thinking, event.index);
      } else if (event.type === 'content_block_stop' && blockTypes.get(event.index) === 'thinking') {
        thinking?.onStop?.(event.index);
      }
    }
    const message = await stream.finalMessage();
    recordUsageAsync(
      meta, message?.usage, params.model || config.anthropic.model, message?.model,
      { messageId: message?.id },
    );
    return { text, message };
  } catch (err) {
    // Aborted / failed mid-stream: Anthropic still bills the tokens generated so far.
    const partial = stream.currentMessage;
    if (partial?.usage) {
      const usage = {
        ...partial.usage,
        output_tokens: Math.max(partial.usage.output_tokens || 0, Math.ceil(text.length / 4)),
      };
      recordUsageAsync(
        meta, usage, params.model || config.anthropic.model, partial.model,
        { messageId: partial.id, partial: true },
      );
    }
    throw err;
  }
}

export { client as anthropicClient };
