/**
 * Nova-backed schedule runs.
 * Scribe follows steps in order; Nova drafts the email/SMS; Scribe delivers.
 */

import { runCoworkerTurn } from '../../nova/agents/coworkerPipeline.js';
import {
  buildScheduledAgentMessage,
  unwrapNovaDeliveryDraft,
} from './deliveryFormat.js';

/**
 * True when this schedule should invoke Nova on each tick.
 * Explicit engine:'nova', or a frozen prompt without legacy process steps.
 */
export function isNovaScheduleFlow(flow = {}) {
  const engine = String(flow.engine || '').toLowerCase().trim();
  if (engine === 'nova') return true;
  if (engine === 'process' || engine === 'flow' || engine === 'steps') return false;

  const prompt = String(flow.prompt || flow.intent || '').trim();
  const hasSteps = Array.isArray(flow.steps) && flow.steps.length > 0;
  const hasPeriods = Array.isArray(flow.periods) && flow.periods.length > 0;
  const dataSource = String(flow.data_source || flow.dataSource || '').toLowerCase();
  if (dataSource === 'invoice_report') return false;
  return Boolean(prompt) && !hasSteps && !hasPeriods;
}

export function resolveNovaPrompt(flow = {}) {
  return String(flow.prompt || flow.intent || flow.message_template || flow.message || '').trim();
}

/** Same chat request → prepare → send. */
export function novaScheduleSteps() {
  return [
    { type: 'nova_run', key: 'nova', label: 'Run Nova (same as chat)' },
    { type: 'compose', key: 'compose', label: 'Prepare delivery' },
    { type: 'deliver', key: 'deliver', label: 'Send' },
  ];
}

/**
 * Headless Nova turn for a schedule tick.
 * @returns {{ response: string, conversationId: string, toolsUsed: string[] }}
 */
export async function runNovaScheduleTurn({
  definition,
  run,
  flow,
  companyId,
  userId,
  channel = 'email',
  dateLabel,
  timeZone,
}) {
  const prompt = resolveNovaPrompt(flow);
  if (!prompt) {
    throw new Error('Nova schedule is missing flow.prompt');
  }
  const name = definition.name || 'Scheduled message';
  const conversationId = `schedule:${definition._id}:${run._id}`;
  const tz = String(timeZone || flow.timezone || definition.timezone || 'UTC');
  const asOf = dateLabel || undefined;

  const result = await runCoworkerTurn({
    message: buildScheduledAgentMessage({
      name,
      prompt,
      channel,
      dateLabel: asOf,
      timeZone: tz,
    }),
    company_id: String(companyId || definition.company_id),
    user_id: String(userId || definition.user_id || ''),
    conversation_id: conversationId,
    sse: () => {},
    options: {
      streamFormatter: false,
      formatOutput: false,
      skipClarification: true,
      skipExecutionPlan: true,
      skipWriteConfirm: false,
    },
  });

  if (result?.type === 'clarification') {
    throw new Error('Nova asked for clarification during a scheduled run (not deliverable)');
  }
  if (result?.type === 'plan_clarify') {
    throw new Error('Nova asked for plan confirmation during a scheduled run (not deliverable)');
  }
  if (result?.type === 'pending_confirmation') {
    throw new Error('Nova requested write confirmation during a scheduled run (not deliverable)');
  }
  if (result?.waiting_continue) {
    throw new Error('Nova paused mid-task during a scheduled run (waiting_continue)');
  }

  const response = String(
    result?.formattedText
    || result?.response
    || result?.rawText
    || '',
  ).trim();
  if (!response) {
    throw new Error('Nova returned no draft for this schedule run');
  }

  const toolsUsed = Array.isArray(result?.toolsUsed)
    ? result.toolsUsed.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
    : [];

  return {
    response,
    conversationId: result?.conversation_id || conversationId,
    toolsUsed,
  };
}

export {
  buildScheduledAgentMessage,
  unwrapNovaDeliveryDraft,
};
