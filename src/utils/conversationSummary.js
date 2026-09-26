/**
 * Rolling LLM-compressed conversation summary stored on Mongo Conversation docs.
 */

import { config } from '../config/index.js';
import { createMessage } from '../llm/anthropicClient.js';
import { normalizeStoredMessages, messageContentToString } from './conversationHistory.js';

/**
 * Build a short "session focus" block for the summarizer (active entities + open task).
 * @param {object} [hints]
 * @returns {string}
 */
export function formatSessionHintsForSummary(hints = {}) {
  const lines = [];
  const ws = hints.workingSet && typeof hints.workingSet === 'object' ? hints.workingSet : null;
  if (ws?.sessionGoal) lines.push(`Goal: ${ws.sessionGoal}`);
  if (ws?.taskState?.goal) {
    lines.push(`Open task: ${ws.taskState.goal} (${ws.taskState.status || 'unknown'})`);
    if (Array.isArray(ws.taskState.next) && ws.taskState.next.length) {
      lines.push(`Next steps: ${ws.taskState.next.slice(0, 5).join('; ')}`);
    }
    if (Array.isArray(ws.taskState.completed) && ws.taskState.completed.length) {
      lines.push(`Completed: ${ws.taskState.completed.slice(0, 5).join('; ')}`);
    }
  } else if (ws?.activeTask?.label) {
    lines.push(`Active task: ${ws.activeTask.label} (${ws.activeTask.status || 'unknown'})`);
  }
  if (ws?.executionPlan?.goal && !ws?.taskState?.goal) {
    lines.push(`Plan: ${ws.executionPlan.goal}`);
  }

  const entities = hints.entities && typeof hints.entities === 'object' ? hints.entities : null;
  if (entities) {
    const keep = Object.entries(entities)
      .filter(([k]) => k === 'sms_draft_id' || k.endsWith('_id'))
      .slice(0, 12)
      .map(([k, v]) => `${k}=${v}`);
    if (keep.length) lines.push(`Active IDs: ${keep.join(', ')}`);
  }

  const refs = hints.entityRefs && typeof hints.entityRefs === 'object' ? hints.entityRefs : null;
  if (refs) {
    const refLines = Object.entries(refs)
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${v?.label || 'unknown'}${v?.id != null ? ` (${v.id})` : ''}`);
    if (refLines.length) lines.push(`Entities: ${refLines.join('; ')}`);
  }

  if (Array.isArray(hints.toolsUsed) && hints.toolsUsed.length) {
    const names = hints.toolsUsed.map((t) => t.name || t.tool).filter(Boolean).slice(-8);
    if (names.length) lines.push(`Recent tools: ${names.join(', ')}`);
  }

  return lines.length ? `Session focus:\n${lines.join('\n')}` : '';
}

/**
 * @param {object} params
 * @param {Array} params.priorMessages
 * @param {string} [params.existingSummary]
 * @param {number} [params.summaryThroughTurn]
 * @param {number} [params.everyN]
 * @param {object} [params.usageMeta]
 * @param {object} [params.sessionHints] - workingSet / entities / tools for P2
 * @returns {Promise<{ summary: string, throughTurn: number }|null>}
 */
export async function maybeRefreshSummary({
  priorMessages = [],
  existingSummary = '',
  summaryThroughTurn = 0,
  everyN = config.coworker?.summaryEveryN ?? 10,
  usageMeta = {},
  sessionHints = null,
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

  const focus = formatSessionHintsForSummary(sessionHints || {});

  const response = await createMessage({
    model: config.anthropic.model,
    max_tokens: 512,
    system:
      'Compress this Worxstream coworker conversation into at most 400 tokens.\n'
      + 'Use these sections when applicable (omit empty ones):\n'
      + '- Goal / open task\n'
      + '- Active entities (name → id; keep customer_id and other IDs verbatim)\n'
      + '- Decisions & outcomes\n'
      + '- Failures / constraints to avoid repeating\n'
      + 'Prefer facts and IDs over prose. Bullet points only.',
    messages: [
      {
        role: 'user',
        content: [
          existingSummary ? `Previous summary:\n${existingSummary}` : '',
          focus,
          `Transcript:\n${transcript}`,
        ].filter(Boolean).join('\n\n'),
      },
    ],
  }, { ...usageMeta, phase: 'summary', agentKey: 'summary' });

  const summary = response.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  if (!summary) return null;
  return { summary, throughTurn: total };
}

export function formatSummaryForPrompt(summary) {
  if (!summary || !String(summary).trim()) return '';
  return `[Conversation summary]\n${String(summary).trim()}`;
}
