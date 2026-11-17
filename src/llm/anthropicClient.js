/**
 * Shared Anthropic client — every Messages API call records official usage.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { recordUsageAsync } from '../analytics/recordUsage.js';
import { fitCallToBudget, getCreditBudget, noteCallCost } from '../analytics/creditGuard.js';

let client = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Tests only: replace the SDK client with a fake. */
export function __setAnthropicClientForTests(fake) {
  client = fake;
}

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
  // Inside a chat turn the call is first fitted to the company's remaining credit (see creditGuard.js).
  const budget = getCreditBudget();
  const sent = budget ? fitCallToBudget(budget, params) : params;
  const response = requestOptions
    ? await client.messages.create(sent, requestOptions)
    : await client.messages.create(sent);
  const recorded = recordUsageAsync(meta, response.usage, sent.model || config.anthropic.model, response.model, { messageId: response.id });
  if (budget) {
    noteCallCost(budget, { model: sent.model || config.anthropic.model, responseModel: response.model, usage: response.usage });
    budget.pending.push(recorded);
  }
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
  const budget = getCreditBudget();
  const sent = budget ? fitCallToBudget(budget, params) : params;
  const stream = requestOptions ? client.messages.stream(sent, requestOptions) : client.messages.stream(sent);
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
    const recorded = recordUsageAsync(
      meta, message?.usage, sent.model || config.anthropic.model, message?.model,
      { messageId: message?.id },
    );
    if (budget) {
      noteCallCost(budget, { model: sent.model || config.anthropic.model, responseModel: message?.model, usage: message?.usage });
      budget.pending.push(recorded);
    }
    return { text, message };
  } catch (err) {
    // Aborted / failed mid-stream: Anthropic still bills the tokens generated so far.
    const partial = stream.currentMessage;
    if (partial?.usage) {
      const usage = {
        ...partial.usage,
        output_tokens: Math.max(partial.usage.output_tokens || 0, Math.ceil(text.length / 4)),
      };
      const recorded = recordUsageAsync(
        meta, usage, sent.model || config.anthropic.model, partial.model,
        { messageId: partial.id, partial: true },
      );
      if (budget) {
        noteCallCost(budget, { model: sent.model || config.anthropic.model, responseModel: partial.model, usage });
        budget.pending.push(recorded);
      }
    }
    throw err;
  }
}

export { client as anthropicClient };
