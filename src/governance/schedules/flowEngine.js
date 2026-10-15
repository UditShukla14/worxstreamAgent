/**
 * Scribe flow-recipe executor.
 * Default (Nova): freeze prompt + channel → run coworker agent on tick → deliver.
 * Legacy: frozen invoice/tool steps (no LLM) for older schedules.
 */

import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
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
import {
  chatReplyForChannel,
  isNovaScheduleFlow,
  novaScheduleSteps,
  resolveNovaPrompt,
  runNovaScheduleTurn,
} from './novaEngine.js';

/**
 * Generic notification schedule. Legacy `sales_email_briefing` still accepted.
 * Nova schedules freeze a prompt and re-run the agent; legacy periods/steps
 * still pull invoice totals without an LLM.
 */
const SUPPORTED_FLOW_TYPES = new Set(['scheduled_message', 'sales_email_briefing']);
const MAX_ACTIVE_FLOW_SCHEDULES = 25;

/** @param {object} flow */
export function resolveFlowChannel(flow = {}) {
  const raw = String(flow.channel || 'email').toLowerCase().trim();
  return raw === 'sms' ? 'sms' : 'email';
}

/**
 * Unwrap callWorxstreamAPI → invoice/generate body without peeling into the rows array.
 * API shape: { success, data: { meta: { totals }, data: rows, pagination } }.
 * Blind `.data` peeling drops meta.totals and yields $0.00 briefings.
 */
export function unwrapInvoiceReportEnvelope(apiResult) {
  const body = apiResult?.data ?? apiResult;
  if (Array.isArray(body)) {
    return { meta: {}, data: body, pagination: {} };
  }
  if (!body || typeof body !== 'object') return {};

  const inner = body.data;
  if (
    inner
    && typeof inner === 'object'
    && !Array.isArray(inner)
    && (
      inner.meta != null
      || Array.isArray(inner.data)
      || Array.isArray(inner.rows)
      || inner.pagination != null
    )
  ) {
    return inner;
  }

  if (
    body.meta != null
    || Array.isArray(body.data)
    || Array.isArray(body.rows)
    || body.pagination != null
  ) {
    return body;
  }

  return body;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(asNumber(n));
}

/**
 * Normalize frozen process steps.
 * Nova: nova_run → compose → deliver (agent uses tools, then we send).
 * Legacy: invoice_report / tool steps, or send-only message_template.
 */
export function resolveFlowSteps(flow = {}) {
  if (isNovaScheduleFlow(flow)) {
    return novaScheduleSteps();
  }

  const rawSteps = Array.isArray(flow.steps) ? flow.steps : [];
  if (rawSteps.length > 0) {
    const steps = rawSteps.map((step, index) => normalizeFlowStep(step, index)).filter(Boolean);
    const hasDeliver = steps.some((s) => s.type === 'deliver');
    const hasCompose = steps.some((s) => s.type === 'compose');
    if (!hasCompose) steps.push({ type: 'compose', key: 'compose', label: 'Compose' });
    if (!hasDeliver) steps.push({ type: 'deliver', key: 'deliver', label: 'Send' });
    return steps;
  }

  const msg = String(flow.message_template || flow.body || flow.message || '');
  const explicitPeriods = Array.isArray(flow.periods)
    ? flow.periods.map((p) => String(p).toLowerCase().trim()).filter(Boolean)
    : [];
  const explicitMetrics = Array.isArray(flow.metrics)
    ? flow.metrics.map((m) => String(m).toLowerCase().trim()).filter(Boolean)
    : [];
  const dataSource = String(flow.data_source || flow.dataSource || '').toLowerCase();
  const wantsInvoiceProcess = dataSource === 'invoice_report'
    || explicitPeriods.length > 0
    || explicitMetrics.length > 0
    || /pulled live at send time/i.test(msg);

  if (wantsInvoiceProcess) {
    let periods = [...explicitPeriods];
    if (!periods.length) {
      if (/quarter-to-date|\bqtd\b/i.test(msg)) periods.push('qtd');
      if (/month-to-date|\bmtd\b/i.test(msg)) periods.push('mtd');
      if (/today|daily/i.test(msg) || periods.length === 0) periods.unshift('today');
      periods = [...new Set(periods)];
    }
    if (!periods.length) periods = ['today', 'mtd'];
    return [
      ...periods.map((period) => normalizeFlowStep({ type: 'invoice_report', period })),
      { type: 'compose', key: 'compose', label: 'Compose' },
      { type: 'deliver', key: 'deliver', label: 'Send' },
    ];
  }

  return [
    { type: 'compose', key: 'compose', label: 'Compose' },
    { type: 'deliver', key: 'deliver', label: 'Send' },
  ];
}

function normalizeFlowStep(step, index = 0) {
  if (!step || typeof step !== 'object') return null;
  const type = String(step.type || step.kind || '').toLowerCase().trim();
  if (type === 'nova_run' || type === 'nova' || type === 'agent') {
    return {
      type: 'nova_run',
      key: String(step.key || 'nova'),
      label: String(step.label || 'Run Nova agent'),
    };
  }
  if (type === 'invoice_report' || type === 'report') {
    const period = String(step.period || step.as || 'today').toLowerCase().trim();
    const labels = { today: 'Today', mtd: 'Month-to-date', qtd: 'Quarter-to-date' };
    return {
      type: 'invoice_report',
      key: String(step.key || `report-${period}`),
      label: String(step.label || `Invoice report (${labels[period] || period})`),
      period,
    };
  }
  if (type === 'tool' || step.tool) {
    const tool = String(step.tool || '').trim();
    if (!tool) return null;
    return {
      type: 'tool',
      key: String(step.key || `tool-${tool}-${index}`),
      label: String(step.label || `Run ${tool}`),
      tool,
      args: step.args && typeof step.args === 'object' ? step.args : {},
      as: step.as ? String(step.as) : tool,
    };
  }
  if (type === 'compose') {
    return { type: 'compose', key: String(step.key || 'compose'), label: String(step.label || 'Compose') };
  }
  if (type === 'deliver' || type === 'send') {
    return { type: 'deliver', key: String(step.key || 'deliver'), label: String(step.label || 'Send') };
  }
  return null;
}

function flowMetrics(flow = {}) {
  const metrics = Array.isArray(flow.metrics)
    ? flow.metrics.map((m) => String(m).toLowerCase().trim()).filter(Boolean)
    : [];
  return metrics.length > 0 ? metrics : ['sales', 'amount_paid'];
}

/**
 * Resolve today / mtd / qtd date windows in the schedule timezone.
 */
export function resolvePeriodWindows(periods, timeZone = 'UTC', asOf = new Date()) {
  const today = formatDateInZone(asOf, timeZone);
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const quarterMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const quarterStart = `${y}-${String(quarterMonth).padStart(2, '0')}-01`;
  const map = {
    today: { from: today, to: today, label: 'Today' },
    mtd: { from: monthStart, to: today, label: 'Month-to-date' },
    qtd: { from: quarterStart, to: today, label: 'Quarter-to-date' },
  };
  const keys = (periods || []).map((p) => String(p).toLowerCase().trim()).filter(Boolean);
  const use = keys.length > 0 ? keys : ['today'];
  return use.filter((k) => map[k]).map((k) => ({ key: k, ...map[k] }));
}

async function fetchInvoicePeriodTotals(range) {
  const { companyId, userId } = getWorxstreamContext();
  const result = await callWorxstreamAPI({
    method: 'POST',
    endpoint: '/report/invoice/generate',
    data: {
      company_id: companyId,
      user_id: userId,
      from_date: range.from,
      to_date: range.to,
      lineItems: false,
      page: 1,
      per_page: 100,
    },
  });
  if (result?.success === false) {
    throw new Error(result?.error || result?.message || 'Invoice report failed');
  }

  const envelope = unwrapInvoiceReportEnvelope(result);
  const meta = envelope.meta && typeof envelope.meta === 'object' ? envelope.meta : {};
  const totalsRaw = meta.totals && typeof meta.totals === 'object' ? meta.totals : {};
  let sales = asNumber(
    totalsRaw.grandTotal ?? totalsRaw.grand_total ?? totalsRaw.sales,
  );
  const rows = Array.isArray(envelope.data)
    ? envelope.data
    : (Array.isArray(envelope.rows) ? envelope.rows : []);
  if (!sales && rows.length > 0) {
    sales = rows.reduce(
      (sum, row) => sum + asNumber(row?.grandTotal ?? row?.grand_total ?? row?.total),
      0,
    );
  }

  let amountPaid = asNumber(
    totalsRaw.amountPaid
    ?? totalsRaw.amount_paid
    ?? totalsRaw.totalPaid
    ?? totalsRaw.total_paid,
  );
  if (!amountPaid && rows.length > 0) {
    amountPaid = rows.reduce((sum, row) => {
      const payments = Array.isArray(row?.payments) ? row.payments : [];
      const rowPaid = payments.reduce((s, p) => s + asNumber(p?.amount), 0);
      if (rowPaid > 0) return sum + rowPaid;
      return sum + asNumber(row?.amountPaid ?? row?.amount_paid ?? row?.totalPaid);
    }, 0);
  }

  const pagination = envelope.pagination || meta.pagination || {};
  const lastPage = Math.max(1, asNumber(pagination.lastPage ?? pagination.last_page) || 1);
  if (
    lastPage > 1
    && !asNumber(totalsRaw.amountPaid ?? totalsRaw.amount_paid)
    && rows.length > 0
  ) {
    for (let page = 2; page <= Math.min(lastPage, 20); page += 1) {
      const pageResult = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/invoice/generate',
        data: {
          company_id: companyId,
          user_id: userId,
          from_date: range.from,
          to_date: range.to,
          lineItems: false,
          page,
          per_page: 100,
        },
      });
      const pageEnv = unwrapInvoiceReportEnvelope(pageResult);
      const pageRows = Array.isArray(pageEnv.data)
        ? pageEnv.data
        : (Array.isArray(pageEnv.rows) ? pageEnv.rows : []);
      amountPaid += pageRows.reduce((sum, row) => {
        const payments = Array.isArray(row?.payments) ? row.payments : [];
        const rowPaid = payments.reduce((s, p) => s + asNumber(p?.amount), 0);
        if (rowPaid > 0) return sum + rowPaid;
        return sum + asNumber(row?.amountPaid ?? row?.amount_paid ?? row?.totalPaid);
      }, 0);
    }
  }

  return {
    from: range.from,
    to: range.to,
    sales,
    amount_paid: amountPaid,
    invoice_count: asNumber(pagination.total ?? meta.total ?? rows.length),
  };
}

export function composeSalesBriefingEmail(opts) {
  const metrics = (opts.metrics || ['sales', 'amount_paid']).map((m) => String(m).toLowerCase());
  const showSales = metrics.includes('sales') || metrics.includes('cumulative_sales');
  const showPaid = metrics.includes('amount_paid') || metrics.includes('paid');

  const rowsHtml = (opts.periods || []).map((p) => {
    const cells = [
      `<td style="padding:8px;border:1px solid #ddd;">${p.label}<br/><span style="color:#666;font-size:12px;">${p.from} → ${p.to}</span></td>`,
    ];
    if (showSales) {
      cells.push(`<td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatMoney(p.sales)}</td>`);
    }
    if (showPaid) {
      cells.push(`<td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatMoney(p.amount_paid)}</td>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  const headers = ['Period'];
  if (showSales) headers.push('Cumulative sales (invoiced)');
  if (showPaid) headers.push('Amount paid');
  const headHtml = headers
    .map((h) => `<th style="padding:8px;border:1px solid #ddd;text-align:left;background:#f5f5f5;">${h}</th>`)
    .join('');

  const subject = String(opts.subject || `${opts.name} — ${opts.periods?.[0]?.to || ''}`.trim());
  const body = `
<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;line-height:1.45;">
  <h2 style="margin:0 0 8px;">${opts.name}</h2>
  <p style="margin:0 0 16px;color:#555;">Company-wide totals (${opts.scope || 'company_totals'}). Generated automatically by Scribe.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;">
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>`.trim();

  return { subject, body };
}

function liveMetricVars(periodResults) {
  const vars = {};
  for (const p of periodResults) {
    vars[`sales_${p.key}`] = formatMoney(p.sales);
    vars[`amount_paid_${p.key}`] = formatMoney(p.amount_paid);
    vars[`invoice_count_${p.key}`] = String(p.invoice_count ?? 0);
  }
  return vars;
}

function templateWantsLivePlaceholders(template) {
  return /\{\{\s*(sales_|amount_paid_|invoice_count_)/i.test(String(template || ''));
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
 * Render frozen templates. Built-ins: {{date}}, {{today}}, {{month_start}},
 * {{quarter_start}}, and {{name}}.
 * Extra vars from opts.vars (e.g. live values Nova froze or a future data step).
 */
export function renderScheduleTemplate(template, opts = {}) {
  const timeZone = opts.timeZone || 'UTC';
  const date = opts.dateLabel || formatDateInZone(new Date(), timeZone);
  const [year, month] = date.split('-').map(Number);
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const name = String(opts.name || 'Schedule');
  const vars = {
    date,
    today: date,
    month_start: `${year}-${String(month).padStart(2, '0')}-01`,
    quarter_start: `${year}-${String(quarterMonth).padStart(2, '0')}-01`,
    name,
    ...(opts.vars || {}),
  };
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
    throw new Error(
      'Cannot compose scheduled delivery: Nova returned no response and no message_template is configured.',
    );
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

function buildInitialFlowProgress(channel, processSteps = []) {
  const composeLabel = channel === 'sms' ? 'Compose SMS' : 'Compose email';
  const sendLabel = channel === 'sms' ? 'Send SMS' : 'Send email';
  const mapped = processSteps.map((step) => {
    let label = step.label;
    if (step.type === 'compose') label = composeLabel;
    if (step.type === 'deliver') label = sendLabel;
    return {
      key: step.key,
      label,
      status: 'pending',
      detail: '',
      at: new Date(),
    };
  });
  return {
    phase: 'starting',
    steps: [
      { key: 'init', label: 'Start run', status: 'pending', detail: '', at: new Date() },
      ...mapped,
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
  const storedFlow = definition.flow && typeof definition.flow === 'object' ? definition.flow : {};
  const flow = { ...storedFlow };
  const storedEngine = String(flow.engine || '').toLowerCase().trim();
  if (storedEngine !== 'send_only' && !isNovaScheduleFlow(flow)) {
    // Repair legacy/partially-created agent schedules at execution time. A
    // missing engine or prompt must never fall through to the static reminder
    // composer; Nova receives a fresh intent instead.
    const legacyIntent = resolveNovaPrompt({
      ...flow,
      message_template: '',
      body: '',
      message: '',
    });
    flow.engine = 'nova';
    flow.prompt = legacyIntent
      || `Execute the scheduled task "${String(definition.name || 'scheduled task')}" using live Worxstream tools and return the result for delivery.`;
  }
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
  const steps = resolveFlowSteps(flow);
  const novaPrompt = resolveNovaPrompt(flow);
  const hasNova = isNovaScheduleFlow(flow) && Boolean(novaPrompt);
  const hasProcess = steps.some((s) => (
    s.type === 'invoice_report' || s.type === 'tool' || s.type === 'nova_run'
  ));
  const hasBody = Boolean(
    String(flow.message_template || flow.body || flow.message || '').trim()
    || String(flow.subject_template || flow.subject || '').trim(),
  );
  const hasFrozenProcess = steps.some((s) => (
    s.type === 'invoice_report' || s.type === 'tool'
  ));
  if (String(flow.engine || '').toLowerCase() === 'send_only'
      && !String(flow.message_template || flow.body || flow.message || '').trim()) {
    throw new Error(
      'Send-only schedule has no message_template. Recreate it as a frozen process with tool steps.',
    );
  }
  if (String(flow.engine || '').toLowerCase() === 'process' && !hasFrozenProcess && !hasNova) {
    throw new Error(
      'Process schedule has no frozen tool steps or Nova intent. Update it with the saved user request.',
    );
  }
  if (!hasNova && !hasProcess && !hasBody) {
    throw new Error(
      'Schedule has no executable Nova intent or frozen process. Update it with the original user request before running.',
    );
  }
  if (isNovaScheduleFlow(flow) && !novaPrompt) {
    throw new Error('Nova schedule requires flow.prompt (the work to run each tick)');
  }
  return { flowType, flow, recipients, channel, steps };
}

function deepRenderArgs(value, vars) {
  if (typeof value === 'string') {
    return renderScheduleTemplate(value, { vars, dateLabel: vars.date, name: vars.name });
  }
  if (Array.isArray(value)) return value.map((v) => deepRenderArgs(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRenderArgs(v, vars);
    return out;
  }
  return value;
}

export async function createPendingFlowRun(definition, meta = {}) {
  const { flow, channel, steps } = assertSupportedFlow(definition);
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
    progress: buildInitialFlowProgress(channel, steps),
  });
}

/**
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {import('../models/ScheduleRun.js').default} run
 */
/**
 * Same chat reply → channel payload. Subject from schedule template only.
 */
function composeFromNovaAgentText(flow, definition, channel, agentText, dateLabel, timeZone) {
  const name = definition.name || 'Scheduled message';
  const body = chatReplyForChannel(agentText, channel);
  if (!body) {
    throw new Error('Nova returned an empty reply for this schedule');
  }
  const subject = renderScheduleTemplate(
    String(flow.subject_template || flow.subject || `${name} — {{date}}`).trim(),
    { name, dateLabel, timeZone },
  );
  if (channel === 'sms') {
    const { text } = withSmsOptOutFooter(body);
    return { channel, subject, body: text, dateLabel };
  }
  return { channel, subject, body, dateLabel };
}

export async function fillFlowRun(definition, run) {
  const { flow, recipients, channel, steps } = assertSupportedFlow(definition);
  const timeZone = String(flow.timezone || definition.timezone || 'UTC');
  const dateLabel = formatDateInZone(new Date(), timeZone);
  const name = definition.name || 'Scheduled message';
  const metrics = flowMetrics(flow);
  const periodResults = [];
  const toolOutputs = {};
  let novaAgentText = '';
  let novaToolsUsed = [];
  let composed = null;
  const { companyId, userId } = getWorxstreamContext();

  // Ensure progress steps exist for this process (older queued runs may lack them)
  if (!run.progress?.steps?.length) {
    run.progress = buildInitialFlowProgress(channel, steps);
    run.markModified('progress');
  }

  try {
    await upsertProgressStep(run, {
      key: 'init',
      status: 'done',
      detail: isNovaScheduleFlow(flow)
        ? `engine=nova channel=${channel} tz=${timeZone}`
        : `channel=${channel} tz=${timeZone} steps=${steps.length}`,
      phase: 'running',
    });

    for (const step of steps) {
      await upsertProgressStep(run, {
        key: step.key,
        status: 'running',
        phase: step.type === 'deliver' ? 'sending' : 'running',
      });

      try {
        if (step.type === 'nova_run') {
          const novaResult = await runNovaScheduleTurn({
            definition,
            run,
            flow,
            companyId,
            userId,
            channel,
            dateLabel,
            timeZone,
          });
          novaAgentText = novaResult.response;
          novaToolsUsed = novaResult.toolsUsed;
          run.conversation_id = novaResult.conversationId;
          await upsertProgressStep(run, {
            key: step.key,
            status: 'done',
            detail: `tools=${novaToolsUsed.length || 0} chars=${novaAgentText.length}`,
            output_summary: {
              tools: novaToolsUsed.slice(0, 20),
              preview: novaAgentText.slice(0, 240),
              conversation_id: novaResult.conversationId,
            },
          });
          continue;
        }

        if (step.type === 'invoice_report') {
          const windows = resolvePeriodWindows([step.period], timeZone);
          const window = windows[0];
          if (!window) throw new Error(`Unknown period "${step.period}"`);
          const totals = await fetchInvoicePeriodTotals(window);
          const row = {
            key: window.key,
            label: window.label,
            from: totals.from,
            to: totals.to,
            sales: totals.sales,
            amount_paid: totals.amount_paid,
            invoice_count: totals.invoice_count,
          };
          periodResults.push(row);
          toolOutputs[window.key] = row;
          await upsertProgressStep(run, {
            key: step.key,
            status: 'done',
            detail: `sales=${totals.sales} paid=${totals.amount_paid}`,
            output_summary: row,
          });
          continue;
        }

        if (step.type === 'tool') {
          const baseVars = {
            date: dateLabel,
            today: dateLabel,
            name,
            ...liveMetricVars(periodResults),
          };
          const args = deepRenderArgs(step.args || {}, baseVars);
          // Expand period shortcuts on tool args
          if (step.args?.period || args.period) {
            const period = String(step.args?.period || args.period).toLowerCase();
            const windows = resolvePeriodWindows([period], timeZone);
            if (windows[0]) {
              if (args.from_date == null) args.from_date = windows[0].from;
              if (args.to_date == null) args.to_date = windows[0].to;
              delete args.period;
            }
          }
          const result = await executeMcpTool(step.tool, args);
          if (result?.success === false) {
            throw new Error(result.error || result.message || `${step.tool} failed`);
          }
          toolOutputs[step.as || step.tool] = result;
          await upsertProgressStep(run, {
            key: step.key,
            status: 'done',
            detail: step.tool,
            output_summary: { tool: step.tool },
          });
          continue;
        }

        if (step.type === 'compose') {
          if (novaAgentText) {
            composed = composeFromNovaAgentText(
              flow,
              definition,
              channel,
              novaAgentText,
              dateLabel,
              timeZone,
            );
          } else {
            const subjectTemplate = String(flow.subject_template || flow.subject || '').trim();
            const messageTemplate = String(
              flow.message_template || flow.body || flow.message || '',
            ).trim();
            const liveVars = liveMetricVars(periodResults);

            if (periodResults.length === 0 && !messageTemplate) {
              throw new Error(
                'Schedule has no Nova response or message template; refusing to send a placeholder reminder.',
              );
            }

            if (periodResults.length > 0 && !templateWantsLivePlaceholders(messageTemplate)) {
              const briefing = composeSalesBriefingEmail({
                name,
                periods: periodResults,
                metrics,
                scope: String(flow.scope || 'company_totals'),
                subject: renderScheduleTemplate(
                  subjectTemplate || `${name} — {{date}}`,
                  { name, dateLabel, timeZone, vars: liveVars },
                ),
              });
              composed = {
                channel,
                subject: briefing.subject,
                body: briefing.body,
                dateLabel,
              };
            } else if (messageTemplate && templateWantsLivePlaceholders(messageTemplate)) {
              composed = composeScheduledMessage(
                {
                  ...flow,
                  subject_template: subjectTemplate || `${name} — {{date}}`,
                  message_template: messageTemplate,
                },
                definition,
                timeZone,
              );
              composed.subject = renderScheduleTemplate(composed.subject, {
                name,
                dateLabel,
                timeZone,
                vars: liveVars,
              });
              composed.body = renderScheduleTemplate(composed.body, {
                name,
                dateLabel,
                timeZone,
                vars: liveVars,
              });
            } else {
              composed = composeScheduledMessage(flow, definition, timeZone);
            }

            if (channel === 'sms' && composed.body && !/STOP/i.test(composed.body)) {
              const { text } = withSmsOptOutFooter(composed.body);
              composed.body = text;
            }
          }

          await upsertProgressStep(run, {
            key: step.key,
            status: 'done',
            detail: channel === 'sms' ? `chars=${composed.body.length}` : composed.subject,
            output_summary: {
              channel,
              subject: composed.subject,
              preview: String(composed.body || '').slice(0, 160),
              period_count: periodResults.length,
              engine: novaAgentText ? 'nova' : 'process',
            },
          });
          continue;
        }

        if (step.type === 'deliver') {
          if (!composed && novaAgentText) {
            composed = composeFromNovaAgentText(
              flow,
              definition,
              channel,
              novaAgentText,
              dateLabel,
              timeZone,
            );
          }
          if (!composed) {
            composed = composeScheduledMessage(flow, definition, timeZone);
          }
          const delivered = await deliverToRecipients({
            channel,
            recipients,
            subject: composed.subject,
            body: composed.body,
          });
          run.delivery = delivered.delivery;
          run.markModified('delivery');
          if (!delivered.ok) {
            run.failed_step = step.key;
            await upsertProgressStep(run, {
              key: step.key,
              status: 'error',
              detail: delivered.error || 'send failed',
            });
            throw new Error(delivered.error || 'send failed');
          }
          await upsertProgressStep(run, {
            key: step.key,
            status: delivered.partial ? 'warn' : 'done',
            detail: delivered.delivery.detail,
            output_summary: { channel, to: recipients },
          });
          run.status = delivered.partial ? 'partial' : 'completed';
          run.error_message = delivered.partial ? delivered.delivery.detail : '';
          continue;
        }

        throw new Error(`Unsupported step type "${step.type}"`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!run.failed_step) run.failed_step = step.key;
        await upsertProgressStep(run, {
          key: step.key,
          status: 'error',
          detail: message,
        });
        throw error;
      }
    }

    run.summary = {
      scanned: 0,
      matched: 0,
      estimates: 0,
      invoices: periodResults.reduce((sum, p) => sum + asNumber(p.invoice_count), 0),
      metrics: {
        channel,
        as_of: dateLabel,
        engine: novaAgentText ? 'nova' : 'process',
        periods: periodResults,
        tools: novaToolsUsed.length ? novaToolsUsed : Object.keys(toolOutputs),
      },
    };
    run.markModified('summary');
    if (!run.status || run.status === 'running') run.status = 'completed';
    run.finished_at = new Date();

    await upsertProgressStep(run, {
      key: 'finalize',
      status: 'done',
      detail: `Process complete (${steps.length} steps)`,
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
      // A scheduled tick is a fresh evaluation of the frozen process. Tool
      // adapters may use this flag to bypass interactive-read caches.
      freshData: true,
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

export {
  SUPPORTED_FLOW_TYPES,
  MAX_ACTIVE_FLOW_SCHEDULES,
  isNovaScheduleFlow,
};
