/**
 * Nova schedule ticks: persist the user's intent → run a fresh Nova turn → send the reply.
 * The schedule stores cadence and delivery metadata; Nova plans and selects tools at fire time.
 */

import { runCoworkerTurn } from '../../nova/agents/coworkerPipeline.js';

/**
 * True when this schedule should invoke Nova on each tick.
 */
export function isNovaScheduleFlow(flow = {}) {
  const engine = String(flow.engine || '').toLowerCase().trim();
  if (engine === 'send_only') return false;
  if (engine === 'nova') return true;

  // Legacy process definitions remain deterministic when they only contain
  // steps/periods. Once an intent is present, they are upgraded to a fresh
  // Nova execution without requiring a migration.
  const explicitIntent = String(flow.prompt || flow.intent || '').trim();
  if (engine === 'process') return Boolean(explicitIntent);
  if (engine) return false;
  return Boolean(explicitIntent);
}

export function resolveNovaPrompt(flow = {}) {
  const explicit = String(flow.prompt || flow.intent || '').trim();
  if (explicit) return explicit;

  // Compatibility for schedules created before Nova became the executor.
  // These descriptions are only a fallback; each run still lets Nova choose
  // and execute the tools against live data.
  const periods = Array.isArray(flow.periods) ? flow.periods.filter(Boolean).join(', ') : '';
  const metrics = Array.isArray(flow.metrics) ? flow.metrics.filter(Boolean).join(', ') : '';
  if (periods || metrics || flow.data_source === 'invoice_report') {
    return [
      'Run the scheduled data task using the appropriate live Worxstream tools.',
      periods ? `Periods: ${periods}.` : '',
      metrics ? `Metrics: ${metrics}.` : '',
      'Return a concise result suitable for delivery to the schedule recipient.',
    ].filter(Boolean).join(' ');
  }

  if (Array.isArray(flow.steps) && flow.steps.length > 0) {
    const tools = flow.steps
      .map((step) => step?.tool || step?.type)
      .filter(Boolean)
      .join(', ');
    return [
      'Execute the saved scheduled workflow using the appropriate live Worxstream tools.',
      tools ? `The previous workflow referenced: ${tools}.` : '',
      'Re-plan the task for the current data and return a concise result suitable for delivery.',
    ].filter(Boolean).join(' ');
  }

  return String(flow.message_template || flow.message || '').trim();
}

/** The saved user intent, sent to a brand-new Nova conversation for this run. */
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
      // Scheduled runs must use Nova's normal planning/tool-selection path.
      // The only frozen inputs are the saved intent and delivery metadata.
      skipExecutionPlan: false,
      autoExecutePlan: true,
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
