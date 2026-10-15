/**
 * Deterministic Scribe flow-recipe executor.
 * Generic scheduled message — email or SMS channel. No LLM at fire time.
 * Frozen: recipients, channel, subject/body templates, cadence.
 */

import { runWithRequestContext } from '../../request/requestContext.js';
import { readEnvApiToken } from '../../utils/worxstreamCredentials.js';
import ScheduleRun from '../models/ScheduleRun.js';
import { executeMcpTool } from '../../mcp/server.js';
import {
  isE164,
  resolveDefaultSmsFrom,
  sendTelnyxMessage,
} from '../../services/telnyxClient.js';
import { withSmsOptOutFooter } from '../../mcp/tools/sms.js';

/**
 * Generic notification schedule. Legacy `sales_email_briefing` still accepted
 * and runs the same path (message templates only — no invoice-report logic).
 */
const SUPPORTED_FLOW_TYPES = new Set(['scheduled_message', 'sales_email_briefing']);
const MAX_ACTIVE_FLOW_SCHEDULES = 25;

/** @param {object} flow */
export function resolveFlowChannel(flow = {}) {
  const raw = String(flow.channel || 'email').toLowerCase().trim();
  return raw === 'sms' ? 'sms' : 'email';
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (DST-safe guess/refine). */
export function zonedLocalToUtc(
  { year, month, day, hour, minute = 0, second = 0 },
  timeZone = 'UTC',
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export function computeMonthlyNextRunAt(definition, fromDate = new Date()) {
  const timeZone = String(
    definition.timezone
    || definition.flow?.timezone
    || 'UTC',
  );
  const dayOfMonth = Math.min(
    28,
    Math.max(1, Math.round(Number(definition.day_of_month ?? definition.flow?.day_of_month) || 1)),
  );
  const hourLocal = Math.min(
    23,
    Math.max(
      0,
      Math.round(Number(definition.run_at_hour_local ?? definition.flow?.run_at_hour_local ?? 9)),
    ),
  );
  const now = getZonedParts(fromDate, timeZone);
  let year = now.year;
  let month = now.month;
  let candidate = zonedLocalToUtc(
    { year, month, day: dayOfMonth, hour: hourLocal },
    timeZone,
  );
  if (candidate <= fromDate) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    candidate = zonedLocalToUtc(
      { year, month, day: dayOfMonth, hour: hourLocal },
      timeZone,
    );
  }
  return candidate;
}

/** Interval (UTC hour + days) or monthly (local day/hour in timezone). */
export function computeFlowNextRunAt(definition, fromDate = new Date()) {
  const cadence = String(
    definition.cadence_type || definition.flow?.cadence_type || 'interval',
  ).toLowerCase();
  if (cadence === 'monthly') {
    return computeMonthlyNextRunAt(definition, fromDate);
  }
  const anchor = new Date(fromDate);
  const hour = Number.isFinite(definition.run_at_hour_utc)
    ? definition.run_at_hour_utc
    : 23;
  anchor.setUTCMinutes(0, 0, 0);
  anchor.setUTCHours(hour, 59, 59, 0);
  if (anchor <= fromDate) {
    anchor.setUTCDate(anchor.getUTCDate() + Math.max(1, definition.interval_days || 1));
  }
  return anchor;
}

/**
 * Format YYYY-MM-DD in a timezone.
 * @param {Date} date
 * @param {string} timeZone
 */
export function formatDateInZone(date, timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* invalid TZ — fall through */
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Render frozen templates. Built-ins: {{date}}, {{name}}.
 * Extra vars from opts.vars (e.g. live values Nova froze or a future data step).
 */
export function renderScheduleTemplate(template, opts = {}) {
  const timeZone = opts.timeZone || 'UTC';
  const date = opts.dateLabel || formatDateInZone(new Date(), timeZone);
  const name = String(opts.name || 'Schedule');
  const vars = { date, name, ...(opts.vars || {}) };
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), String(value));
  }
  return out;
}

export function composeScheduledMessage(flow, definition, timeZone) {
  const channel = resolveFlowChannel(flow);
  const dateLabel = formatDateInZone(new Date(), timeZone);
  const name = definition.name || 'Scheduled message';
  const subject = renderScheduleTemplate(
    flow.subject_template || flow.subject || name,
    { name, dateLabel, timeZone },
  );
  let body = renderScheduleTemplate(
    flow.message_template || flow.body || flow.message || '',
    { name, dateLabel, timeZone },
  );
  if (!body.trim()) {
    body = channel === 'sms'
      ? `${name} — reminder for ${dateLabel}.`
      : `<p>${name}</p><p>Scheduled reminder for ${dateLabel}.</p>`;
  }
  if (channel === 'sms') {
    const { text } = withSmsOptOutFooter(body);
    return { channel, subject, body: text, dateLabel };
  }
  // Email: allow plain text → wrap lightly if no HTML tags
  if (!/<[a-z][\s\S]*>/i.test(body)) {
    body = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;line-height:1.45;">${
      body.split(/\n+/).map((line) => `<p style="margin:0 0 8px;">${line}</p>`).join('')
    }</div>`;
  }
  return { channel, subject, body, dateLabel };
}

async function deliverToRecipients({ channel, recipients, subject, body }) {
  if (channel === 'sms') {
    const sendResults = [];
    for (const to of recipients) {
      const from = resolveDefaultSmsFrom(to);
      const sent = await sendTelnyxMessage({ to, text: body, from });
      sendResults.push({
        to,
        success: sent?.success !== false && !sent?.error,
        id: sent?.data?.id || sent?.id || '',
        error: sent?.error || sent?.message || '',
      });
    }
    const ok = sendResults.filter((r) => r.success);
    const failed = sendResults.filter((r) => !r.success);
    if (ok.length === 0) {
      const message = failed.map((r) => `${r.to}: ${r.error || 'failed'}`).join('; ') || 'SMS send failed';
      return {
        ok: false,
        partial: false,
        delivery: {
          channel: 'sms',
          to: recipients,
          subject: subject || '',
          status: 'failed',
          provider_id: '',
          detail: message,
        },
        error: message,
      };
    }
    return {
      ok: true,
      partial: failed.length > 0,
      delivery: {
        channel: 'sms',
        to: recipients,
        subject: subject || '',
        status: failed.length ? 'partial' : 'sent',
        provider_id: ok.map((r) => r.id).filter(Boolean).join(',') || '',
        detail: failed.length
          ? `Sent ${ok.length}/${recipients.length}; failed: ${failed.map((r) => r.to).join(',')}`
          : `Sent via Telnyx to ${ok.length} recipient(s)`,
      },
    };
  }

  const sent = await executeMcpTool('send_email', {
    mail_to: recipients,
    subject,
    body,
  });
  if (sent?.success === false || sent?.error) {
    const message = sent.error || sent.message || 'send_email failed';
    return {
      ok: false,
      partial: false,
      delivery: {
        channel: 'email',
        to: recipients,
        subject,
        status: 'failed',
        provider_id: '',
        detail: message,
      },
      error: message,
    };
  }
  const providerId = String(
    sent?.data?.id
    ?? sent?.data?.outbox_id
    ?? sent?.data?.message_id
    ?? sent?.id
    ?? '',
  );
  return {
    ok: true,
    partial: false,
    delivery: {
      channel: 'email',
      to: recipients,
      subject,
      status: 'sent',
      provider_id: providerId,
      detail: sent?.message || 'Sent via send_email tool',
    },
  };
}

const runSaveQueues = new WeakMap();

function enqueueRunMutation(run, mutate) {
  const previous = runSaveQueues.get(run) || Promise.resolve();
  const next = previous.then(async () => {
    await mutate();
  });
  runSaveQueues.set(run, next.catch(() => {}));
  return next;
}

function applyProgressStep(run, { key, label, status, detail, phase, output_summary }) {
  if (!run.progress?.steps) {
    run.progress = { phase: 'starting', steps: [] };
  }
  const steps = run.progress.steps;
  const index = steps.findIndex((step) => step.key === key);
  const next = {
    key,
    label: label ?? (index >= 0 ? steps[index].label : key),
    status,
    detail: detail ?? (index >= 0 ? steps[index].detail : ''),
    output_summary: output_summary !== undefined
      ? output_summary
      : (index >= 0 ? steps[index].output_summary : undefined),
    at: new Date(),
  };
  if (index >= 0) steps[index] = next;
  else steps.push(next);
  if (phase) run.progress.phase = phase;
  run.markModified('progress');
}

async function upsertProgressStep(run, update) {
  return enqueueRunMutation(run, async () => {
    applyProgressStep(run, update);
    await run.save();
  });
}

function buildInitialFlowProgress(channel) {
  const composeLabel = channel === 'sms' ? 'Compose SMS' : 'Compose email';
  const sendLabel = channel === 'sms' ? 'Send SMS' : 'Send email';
  return {
    phase: 'starting',
    steps: [
      { key: 'init', label: 'Start run', status: 'pending', detail: '', at: new Date() },
      { key: 'compose', label: composeLabel, status: 'pending', detail: '', at: new Date() },
      { key: 'send', label: sendLabel, status: 'pending', detail: '', at: new Date() },
      { key: 'finalize', label: 'Finalize', status: 'pending', detail: '', at: new Date() },
    ],
  };
}

export function isFlowRecipe(definition) {
  return String(definition?.kind || '') === 'flow_recipe'
    || Boolean(definition?.flow_type);
}

export function assertSupportedFlow(definition) {
  const flowType = String(definition.flow_type || '').trim();
  if (!SUPPORTED_FLOW_TYPES.has(flowType)) {
    throw new Error(
      `Unsupported flow_type "${flowType}". Supported: ${[...SUPPORTED_FLOW_TYPES].join(', ')}`,
    );
  }
  const flow = definition.flow && typeof definition.flow === 'object' ? definition.flow : {};
  const channel = resolveFlowChannel(flow);
  const recipients = Array.isArray(flow.recipients)
    ? flow.recipients.map((r) => String(r).trim()).filter(Boolean)
    : [];
  if (recipients.length === 0) {
    throw new Error(
      channel === 'sms'
        ? 'flow.recipients must include at least one E.164 phone number'
        : 'flow.recipients must include at least one email address',
    );
  }
  if (channel === 'sms') {
    const bad = recipients.filter((r) => !isE164(r));
    if (bad.length > 0) {
      throw new Error(`Invalid SMS recipients (need E.164): ${bad.slice(0, 3).join(', ')}`);
    }
  }
  const hasBody = Boolean(
    String(flow.message_template || flow.body || flow.message || '').trim()
    || String(flow.subject_template || flow.subject || '').trim(),
  );
  if (!hasBody && !definition.name) {
    throw new Error('flow.message_template (or body) is required');
  }
  return { flowType, flow, recipients, channel };
}

export async function createPendingFlowRun(definition, meta = {}) {
  const { flow, channel } = assertSupportedFlow(definition);
  const timeZone = String(flow.timezone || definition.timezone || 'UTC');
  const today = formatDateInZone(new Date(), timeZone);
  const periodStart = new Date(`${today}T00:00:00.000Z`);
  const periodEnd = new Date(`${today}T23:59:59.999Z`);

  return ScheduleRun.create({
    company_id: String(meta.companyId || definition.company_id),
    user_id: String(meta.userId || definition.user_id || ''),
    definition_id: definition._id,
    definition_name: definition.name,
    kind: 'flow_recipe',
    flow_type: definition.flow_type,
    conversation_id: definition.conversation_id || null,
    trigger: meta.trigger === 'scheduled' ? 'scheduled' : 'manual',
    period_start: periodStart,
    period_end: periodEnd,
    status: 'running',
    started_at: new Date(),
    generated_at: new Date(),
    progress: buildInitialFlowProgress(channel),
  });
}

/**
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {import('../models/ScheduleRun.js').default} run
 */
export async function fillFlowRun(definition, run) {
  const { flow, recipients, channel } = assertSupportedFlow(definition);
  const timeZone = String(flow.timezone || definition.timezone || 'UTC');

  try {
    await upsertProgressStep(run, {
      key: 'init',
      status: 'done',
      detail: `channel=${channel} tz=${timeZone}`,
      phase: 'composing',
    });

    await upsertProgressStep(run, {
      key: 'compose',
      status: 'running',
      phase: 'composing',
    });

    const composed = composeScheduledMessage(flow, definition, timeZone);

    await upsertProgressStep(run, {
      key: 'compose',
      status: 'done',
      detail: channel === 'sms' ? `chars=${composed.body.length}` : composed.subject,
      output_summary: {
        channel,
        subject: composed.subject,
        preview: composed.body.slice(0, 160),
      },
    });

    await upsertProgressStep(run, {
      key: 'send',
      status: 'running',
      phase: 'sending',
    });

    const delivered = await deliverToRecipients({
      channel,
      recipients,
      subject: composed.subject,
      body: composed.body,
    });
    run.delivery = delivered.delivery;
    run.markModified('delivery');
    if (!delivered.ok) {
      run.failed_step = 'send';
      await upsertProgressStep(run, {
        key: 'send',
        status: 'error',
        detail: delivered.error || 'send failed',
      });
      throw new Error(delivered.error || 'send failed');
    }
    await upsertProgressStep(run, {
      key: 'send',
      status: delivered.partial ? 'warn' : 'done',
      detail: delivered.delivery.detail,
      output_summary: { channel, to: recipients },
    });

    run.status = delivered.partial ? 'partial' : 'completed';
    run.error_message = delivered.partial ? delivered.delivery.detail : '';
    run.summary = {
      scanned: 0,
      matched: 0,
      estimates: 0,
      invoices: 0,
      metrics: {
        channel,
        as_of: composed.dateLabel,
      },
    };
    run.markModified('summary');
    run.finished_at = new Date();

    await upsertProgressStep(run, {
      key: 'finalize',
      status: 'done',
      detail: `Sent via ${channel}`,
      phase: 'done',
    });

    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    run.status = 'error';
    run.error_message = message;
    run.error_stack = stack || '';
    run.finished_at = new Date();
    await upsertProgressStep(run, {
      key: 'finalize',
      status: 'error',
      detail: message,
      phase: 'done',
    });
    throw error;
  }
}

async function withDefinitionCredentials(definition, options, fn) {
  const apiToken = String(options.apiToken || readEnvApiToken() || '').trim();
  if (!apiToken) {
    throw new Error(
      'WORXSTREAM_API_TOKEN (or options.apiToken) is required for Scribe schedule runs.',
    );
  }
  return runWithRequestContext(
    {
      companyId: String(definition.company_id),
      userId: String(options.userId || definition.user_id || ''),
      apiToken,
    },
    fn,
  );
}

export async function executeFlowRecipe(definition, options = {}) {
  assertSupportedFlow(definition);
  const run = await createPendingFlowRun(definition, {
    companyId: definition.company_id,
    userId: definition.user_id,
    trigger: options.trigger === 'scheduled' ? 'scheduled' : 'manual',
  });

  try {
    await withDefinitionCredentials(definition, options, () => fillFlowRun(definition, run));
  } catch (error) {
    if (run.status === 'running') {
      run.status = 'error';
      run.error_message = error instanceof Error ? error.message : String(error);
      run.error_stack = error instanceof Error ? (error.stack || '') : '';
      run.finished_at = new Date();
      await run.save().catch(() => {});
    }
    definition.next_run_at = new Date(Date.now() + 60 * 60 * 1000);
    await definition.save().catch(() => {});
    throw error;
  }

  definition.last_run_at = new Date();
  definition.next_run_at = computeFlowNextRunAt(definition, new Date());
  await definition.save();
  return run;
}

export async function queueFlowRecipe(definition, options = {}) {
  const companyId = String(options.companyId || definition.company_id);
  if (String(definition.company_id) !== companyId) {
    throw new Error('Schedule does not belong to this company.');
  }
  assertSupportedFlow(definition);
  const run = await createPendingFlowRun(definition, {
    companyId,
    userId: options.userId || definition.user_id,
    trigger: options.trigger === 'scheduled' ? 'scheduled' : 'manual',
  });

  setImmediate(() => {
    withDefinitionCredentials(definition, options, async () => {
      await fillFlowRun(definition, run);
      definition.last_run_at = new Date();
      definition.next_run_at = computeFlowNextRunAt(definition, new Date());
      await definition.save();
    }).catch(async (error) => {
      console.error(
        `❌ Flow run failed (${definition.name}):`,
        error instanceof Error ? error.message : error,
      );
      if (run.status === 'running') {
        run.status = 'error';
        run.error_message = error instanceof Error ? error.message : String(error);
        run.error_stack = error instanceof Error ? (error.stack || '') : '';
        run.finished_at = new Date();
        await upsertProgressStep(run, {
          key: 'finalize',
          status: 'error',
          detail: run.error_message,
          phase: 'done',
        }).catch(() => {});
      }
      definition.next_run_at = new Date(Date.now() + 60 * 60 * 1000);
      await definition.save().catch(() => {});
    });
  });

  return run;
}

export { SUPPORTED_FLOW_TYPES, MAX_ACTIVE_FLOW_SCHEDULES };
