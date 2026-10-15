/**
 * Deterministic Scribe flow-recipe executor.
 * Frozen flow config from ScheduleDefinition — no LLM at fire time.
 */

import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { runWithRequestContext } from '../../request/requestContext.js';
import { readEnvApiToken } from '../../utils/worxstreamCredentials.js';
import ScheduleRun from '../models/ScheduleRun.js';
import { executeMcpTool } from '../../mcp/server.js';

const SUPPORTED_FLOW_TYPES = new Set(['sales_email_briefing']);
const MAX_ACTIVE_FLOW_SCHEDULES = 25;

/** Same cadence rule as criteria reports (UTC hour + interval_days). */
export function computeFlowNextRunAt(definition, fromDate = new Date()) {
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

/** @param {unknown} value */
function peel(value) {
  let current = value;
  for (let i = 0; i < 5; i += 1) {
    if (!current || typeof current !== 'object') return current;
    if (Array.isArray(current)) return current;
    const inner = current.data ?? current.item ?? current.result;
    if (inner == null) return current;
    current = inner;
  }
  return current;
}

/** @param {unknown} value */
function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
 * Resolve today / mtd / qtd date windows in the schedule timezone.
 * @param {string[]} periods
 * @param {string} timeZone
 * @param {Date} [asOf]
 */
export function resolvePeriodWindows(periods, timeZone = 'UTC', asOf = new Date()) {
  const today = formatDateInZone(asOf, timeZone);
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const quarterMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const quarterStart = `${y}-${String(quarterMonth).padStart(2, '0')}-01`;

  /** @type {Record<string, { from: string, to: string, label: string }>} */
  const map = {
    today: { from: today, to: today, label: 'Today' },
    mtd: { from: monthStart, to: today, label: 'Month-to-date' },
    qtd: { from: quarterStart, to: today, label: 'Quarter-to-date' },
  };

  const requested = (periods || []).map((p) => String(p).toLowerCase().trim());
  const keys = requested.length > 0 ? requested : ['today'];
  return keys
    .filter((k) => map[k])
    .map((k) => ({ key: k, ...map[k] }));
}

/**
 * Pull company totals from invoice report for a date range.
 * @param {{ from: string, to: string }} range
 */
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

  const envelope = peel(result?.data ?? result) || {};
  const meta = envelope.meta || envelope;
  const totalsRaw = meta.totals || {};
  const sales = asNumber(
    totalsRaw.grandTotal ?? totalsRaw.grand_total ?? totalsRaw.sales,
  );

  const rows = Array.isArray(envelope.data)
    ? envelope.data
    : Array.isArray(envelope.rows)
      ? envelope.rows
      : [];

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

  // Paginate remaining pages only when we need payment sums and meta lacked amountPaid
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
      const pageEnv = peel(pageResult?.data ?? pageResult) || {};
      const pageRows = Array.isArray(pageEnv.data) ? pageEnv.data : [];
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

function formatMoney(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(asNumber(n));
}

/**
 * @param {{
 *   name: string,
 *   periods: Array<{ key: string, label: string, from: string, to: string, sales: number, amount_paid: number }>,
 *   metrics: string[],
 *   scope: string,
 * }} opts
 */
export function composeSalesBriefingEmail(opts) {
  const metrics = (opts.metrics || ['sales', 'amount_paid']).map((m) => String(m).toLowerCase());
  const showSales = metrics.includes('sales') || metrics.includes('cumulative_sales');
  const showPaid = metrics.includes('amount_paid') || metrics.includes('paid');

  const rowsHtml = (opts.periods || []).map((p) => {
    const cells = [];
    cells.push(`<td style="padding:8px;border:1px solid #ddd;">${p.label}<br/><span style="color:#666;font-size:12px;">${p.from} → ${p.to}</span></td>`);
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

function buildInitialFlowProgress(definition, windows) {
  const steps = [
    { key: 'init', label: 'Start run', status: 'pending', detail: '', at: new Date() },
    ...windows.map((w) => ({
      key: `report-${w.key}`,
      label: `Invoice report (${w.label})`,
      status: 'pending',
      detail: '',
      at: new Date(),
    })),
    { key: 'compose', label: 'Compose email', status: 'pending', detail: '', at: new Date() },
    { key: 'send', label: 'Send email', status: 'pending', detail: '', at: new Date() },
    { key: 'finalize', label: 'Finalize', status: 'pending', detail: '', at: new Date() },
  ];
  return { phase: 'starting', steps };
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
  const recipients = Array.isArray(flow.recipients) ? flow.recipients : [];
  if (recipients.length === 0) {
    throw new Error('flow.recipients must include at least one email address');
  }
  return { flowType, flow, recipients };
}

/**
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {{ companyId?: string, userId?: string, trigger?: 'manual' | 'scheduled' }} [meta]
 */
export async function createPendingFlowRun(definition, meta = {}) {
  const { flow } = assertSupportedFlow(definition);
  const timeZone = String(flow.timezone || definition.timezone || 'UTC');
  const periods = Array.isArray(flow.periods) ? flow.periods : ['today'];
  const windows = resolvePeriodWindows(periods, timeZone);
  const first = windows[0];
  const last = windows[windows.length - 1] || first;
  const periodStart = new Date(`${first?.from || formatDateInZone(new Date())}T00:00:00.000Z`);
  const periodEnd = new Date(`${last?.to || first?.to || formatDateInZone(new Date())}T23:59:59.999Z`);

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
    progress: buildInitialFlowProgress(definition, windows),
  });
}

/**
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {import('../models/ScheduleRun.js').default} run
 */
export async function fillFlowRun(definition, run) {
  const { flow, recipients } = assertSupportedFlow(definition);
  const timeZone = String(flow.timezone || definition.timezone || 'UTC');
  const periods = Array.isArray(flow.periods) ? flow.periods : ['today'];
  const metrics = Array.isArray(flow.metrics) ? flow.metrics : ['sales', 'amount_paid'];
  const scope = String(flow.scope || 'company_totals');
  const windows = resolvePeriodWindows(periods, timeZone);

  try {
    await upsertProgressStep(run, {
      key: 'init',
      status: 'done',
      detail: `flow=${definition.flow_type} tz=${timeZone}`,
      phase: 'reporting',
    });

    const periodResults = [];
    for (const window of windows) {
      const stepKey = `report-${window.key}`;
      await upsertProgressStep(run, {
        key: stepKey,
        status: 'running',
        detail: `${window.from} → ${window.to}`,
        phase: 'reporting',
      });
      try {
        const totals = await fetchInvoicePeriodTotals(window);
        periodResults.push({
          key: window.key,
          label: window.label,
          from: totals.from,
          to: totals.to,
          sales: totals.sales,
          amount_paid: totals.amount_paid,
          invoice_count: totals.invoice_count,
        });
        await upsertProgressStep(run, {
          key: stepKey,
          status: 'done',
          detail: `sales=${totals.sales} paid=${totals.amount_paid}`,
          output_summary: totals,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.failed_step = stepKey;
        await upsertProgressStep(run, {
          key: stepKey,
          status: 'error',
          detail: message,
        });
        throw error;
      }
    }

    await upsertProgressStep(run, {
      key: 'compose',
      status: 'running',
      phase: 'composing',
    });

    const subjectTemplate = String(flow.subject_template || '').trim();
    const composed = composeSalesBriefingEmail({
      name: definition.name,
      periods: periodResults,
      metrics,
      scope,
      subject: subjectTemplate
        || `${definition.name} — ${periodResults[0]?.to || formatDateInZone(new Date(), timeZone)}`,
    });

    await upsertProgressStep(run, {
      key: 'compose',
      status: 'done',
      detail: composed.subject,
      output_summary: { subject: composed.subject, period_count: periodResults.length },
    });

    await upsertProgressStep(run, {
      key: 'send',
      status: 'running',
      phase: 'sending',
    });

    try {
      // Use the shared MCP email tool (same path Nova uses) — no SCRIBE_EMAIL env.
      const sent = await executeMcpTool('send_email', {
        mail_to: recipients,
        subject: composed.subject,
        body: composed.body,
        include_pdf: false,
      });
      if (sent?.success === false || sent?.error) {
        throw new Error(sent.error || sent.message || 'send_email failed');
      }
      const providerId = String(
        sent?.data?.id
        ?? sent?.data?.outbox_id
        ?? sent?.data?.message_id
        ?? sent?.id
        ?? '',
      );
      run.delivery = {
        channel: 'email',
        to: recipients,
        subject: composed.subject,
        status: 'sent',
        provider_id: providerId,
        detail: sent?.message || 'Sent via send_email tool',
      };
      run.markModified('delivery');
      await upsertProgressStep(run, {
        key: 'send',
        status: 'done',
        detail: `tool=send_email to=${recipients.join(',')}`,
        output_summary: {
          tool: 'send_email',
          providerId: providerId || undefined,
          to: recipients,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.failed_step = 'send';
      run.delivery = {
        channel: 'email',
        to: recipients,
        subject: composed.subject,
        status: 'failed',
        provider_id: '',
        detail: message,
      };
      run.markModified('delivery');
      await upsertProgressStep(run, {
        key: 'send',
        status: 'error',
        detail: message,
      });
      throw error;
    }

    run.status = 'completed';
    run.error_message = '';
    run.summary = {
      scanned: periodResults.reduce((s, p) => s + (p.invoice_count || 0), 0),
      matched: 0,
      estimates: 0,
      invoices: periodResults.reduce((s, p) => s + (p.invoice_count || 0), 0),
      metrics: {
        periods: periodResults,
        metrics,
        scope,
      },
    };
    run.markModified('summary');
    run.finished_at = new Date();

    await upsertProgressStep(run, {
      key: 'finalize',
      status: 'done',
      detail: 'Briefing sent',
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

/**
 * Execute a flow recipe end-to-end (creates Mongo run log first).
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {{ trigger?: 'scheduled' | 'manual', apiToken?: string, userId?: string }} [options]
 */
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

/**
 * Queue a flow run in the background; return pending run immediately.
 * @param {import('../models/ScheduleDefinition.js').default} definition
 * @param {{ apiToken?: string, userId?: string, companyId?: string, trigger?: 'manual' | 'scheduled' }} options
 */
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
