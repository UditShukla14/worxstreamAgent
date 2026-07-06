/**
 * Rolling LLM-compressed conversation summary stored on Mongo Conversation docs.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { normalizeStoredMessages, messageContentToString } from './conversationHistory.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * @param {object} params
 * @param {Array} params.priorMessages
 * @param {string} [params.existingSummary]
 * @param {number} [params.summaryThroughTurn]
 * @param {number} [params.everyN]
 * @returns {Promise<{ summary: string, throughTurn: number }|null>}
 */
export async function maybeRefreshSummary({
  priorMessages = [],
  existingSummary = '',
  summaryThroughTurn = 0,
  everyN = config.coworker?.summaryEveryN ?? 10,
}) {
  const normalized = normalizeStoredMessages(priorMessages);
  const total = normalized.length;
  if (total < everyN) return null;
  if (total - summaryThroughTurn < everyN) return null;

  const toSummarize = normalized.slice(0, Math.max(0, total - 2));
  if (toSummarize.length === 0) return null;

  const transcript = toSummarize
    .map((m) => `${m.role}: ${messageContentToString(m.content).slice(0, 800)}`)
    .join('\n');

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    system: 'Compress this Worxstream assistant conversation into at most 400 tokens. Preserve: numeric IDs (especially 300-series customer_id), open tasks, failures, and user goals. Use bullet points.',
    messages: [
      {
        role: 'user',
        content: existingSummary
          ? `Previous summary:\n${existingSummary}\n\nNew transcript:\n${transcript}`
          : `Transcript:\n${transcript}`,
      },
    ],
  });

  const summary = response.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  if (!summary) return null;
  return { summary, throughTurn: total };
}

export function formatSummaryForPrompt(summary) {
  if (!summary || !String(summary).trim()) return '';
  return `[Conversation summary]\n${String(summary).trim()}`;
}
