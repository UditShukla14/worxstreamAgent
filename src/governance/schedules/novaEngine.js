/**
 * Nova schedule ticks: freeze prompt → run Nova like chat → send that reply.
 */

import { runCoworkerTurn } from '../../nova/agents/coworkerPipeline.js';

/**
 * True when this schedule should invoke Nova on each tick.
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

/** Frozen prompt only — same text the user would send in chat. */
export function buildScheduledAgentMessage(prompt) {
  return String(prompt || '').trim();
}

export function novaScheduleSteps() {
  return [
    { type: 'nova_run', key: 'nova', label: 'Run Nova (same as chat)' },
    { type: 'deliver', key: 'deliver', label: 'Send reply' },
  ];
}

/**
 * Headless Nova turn — same pipeline as chat, frozen prompt as the user message.
 * @returns {{ response: string, conversationId: string, toolsUsed: string[] }}
 */
export async function runNovaScheduleTurn({
  definition,
  run,
  flow,
  companyId,
  userId,
}) {
  const prompt = resolveNovaPrompt(flow);
  if (!prompt) {
    throw new Error('Nova schedule is missing flow.prompt');
  }
  const conversationId = `schedule:${definition._id}:${run._id}`;

  const result = await runCoworkerTurn({
    message: buildScheduledAgentMessage(prompt),
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
    throw new Error('Nova returned an empty reply for this schedule run');
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

/**
 * Adapt the same chat reply for the delivery channel (no redesign).
 * Email: keep HTML as-is, or wrap plain text.
 * SMS: plain text only.
 */
export function chatReplyForChannel(text, channel = 'email') {
  const raw = String(text || '').trim();
  if (!raw) return '';

  if (channel === 'sms') {
    let body = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (body.length > 1400) body = `${body.slice(0, 1397)}...`;
    return body;
  }

  // Email: send the chat reply; wrap only if it has no markup.
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;line-height:1.5;white-space:pre-wrap;">${
    escapeHtml(raw)
  }</div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
