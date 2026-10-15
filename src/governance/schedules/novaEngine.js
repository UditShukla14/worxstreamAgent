/**
 * Nova-backed schedule runs: freeze a prompt, re-run the coworker agent on tick
 * (full tool access), then hand the response back for compose + deliver.
 */

import { runCoworkerTurn } from '../../nova/agents/coworkerPipeline.js';

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

export function novaScheduleSteps() {
  return [
    { type: 'nova_run', key: 'nova', label: 'Run Nova agent' },
    { type: 'compose', key: 'compose', label: 'Compose' },
    { type: 'deliver', key: 'deliver', label: 'Send' },
  ];
}

/**
 * Strip chart/stats/UI-only tags; keep prose and simple tables for email/SMS.
 */
export function stripAgentPresentationForDelivery(text, channel = 'email') {
  let body = String(text || '');
  body = body
    .replace(/<chart\b[\s\S]*?<\/chart>/gi, '')
    .replace(/<stats\b[\s\S]*?<\/stats>/gi, '')
    .replace(/<workflow\b[\s\S]*?<\/workflow>/gi, '')
    .replace(/<details\b[\s\S]*?<\/details>/gi, '')
    .replace(/<alert\b[\s\S]*?<\/alert>/gi, '')
    .replace(/<!--AGENT_BLK_\d+-->/g, '');

  if (channel === 'sms') {
    body = body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/(h[1-6]|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (body.length > 1400) body = `${body.slice(0, 1397)}...`;
    return body;
  }

  return body.trim();
}

function buildScheduledAgentMessage({ name, prompt, channel }) {
  const deliveryHint = channel === 'sms'
    ? 'Write a concise plain-text answer suitable for SMS (no HTML, no charts).'
    : 'Write a clear email-ready answer (prose and HTML tables OK). Do not use chart/stats/workflow tags.';

  return [
    `[Scheduled run: ${name}]`,
    'Complete the following request now.',
    'Do not ask clarifying questions.',
    'Do not call send_email, SMS, or other delivery tools — delivery is handled after you respond.',
    'Prefer read-only tools (reports, lists, lookups). Avoid creates/updates/deletes unless the request explicitly requires a write.',
    deliveryHint,
    '',
    prompt,
  ].join('\n');
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
}) {
  const prompt = resolveNovaPrompt(flow);
  if (!prompt) {
    throw new Error('Nova schedule is missing flow.prompt');
  }
  const name = definition.name || 'Scheduled message';
  const conversationId = `schedule:${definition._id}:${run._id}`;

  const result = await runCoworkerTurn({
    message: buildScheduledAgentMessage({ name, prompt, channel }),
    company_id: String(companyId || definition.company_id),
    user_id: String(userId || definition.user_id || ''),
    conversation_id: conversationId,
    sse: () => {},
    options: {
      streamFormatter: false,
      formatOutput: false,
      skipClarification: true,
      skipExecutionPlan: true,
      // Background ticks have no Approve UI — fail closed on pending_confirmation.
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
    throw new Error('Nova returned no text for this schedule run');
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
