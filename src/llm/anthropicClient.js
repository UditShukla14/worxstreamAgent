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
 * @returns {Promise<import('@anthropic-ai/sdk').Anthropic.Message>}
 */
export async function createMessage(params, meta = {}) {
  const response = await client.messages.create(params);
  recordUsageAsync(meta, response.usage, params.model || config.anthropic.model);
  return response;
}

/**
 * Stream a message; yields SDK stream events. Records usage from finalMessage().
 *
 * @param {import('@anthropic-ai/sdk').Anthropic.MessageStreamParams} params
 * @param {LlmCallMeta} [meta]
 * @param {(delta: string) => void} [onTextDelta]
 * @returns {Promise<{ text: string, message: import('@anthropic-ai/sdk').Anthropic.Message }>}
 */
export async function streamMessage(params, meta = {}, onTextDelta = () => {}) {
  const stream = client.messages.stream(params);
  let text = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text;
      onTextDelta(event.delta.text);
    }
  }

  const message = await stream.finalMessage();
  recordUsageAsync(meta, message?.usage, params.model || config.anthropic.model);
  return { text, message };
}

export { client as anthropicClient };
