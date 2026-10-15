/**
 * Scribe schedule MCP tools — Nova hands off recurring work to Scribe.
 * Domain: scribe (visible to Nova tool-search; not governance-gated).
 */

import { z } from 'zod';
import { registerTool } from '../../mcp/server.js';
import { getWorxstreamContext } from '../../config/index.js';
import ScheduleDefinition from '../models/ScheduleDefinition.js';
import ScheduleRun from '../models/ScheduleRun.js';
import {
  computeNextRunAt,
  queueScheduleDefinition,
} from '../schedules/engine.js';
import {
  MAX_ACTIVE_FLOW_SCHEDULES,
  SUPPORTED_FLOW_TYPES,
  computeFlowNextRunAt,
  isFlowRecipe,
} from '../schedules/flowEngine.js';
import { isE164 } from '../../services/telnyxClient.js';
import {
  activeQuery,
  definitionToApi,
  runDetailToApi,
  runToApi,
} from '../schedules/routes.js';

function asText(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** Nova schedules are per (company_id, user_id), same as conversations. */
function ownerFilter(companyId, userId, extra = {}) {
  return {
    company_id: String(companyId),
    user_id: String(userId),
    ...extra,
  };
}

function parseRecipients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function resolveChannel(input) {
  const raw = String(input.channel || 'email').toLowerCase().trim();
  return raw === 'sms' ? 'sms' : 'email';
}

function parseStringList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

function parseSteps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step) => {
      if (!step || typeof step !== 'object') return null;
      const type = String(step.type || '').toLowerCase().trim();
      if (type === 'invoice_report' || type === 'report') {
        return {
          type: 'invoice_report',
          period: String(step.period || 'today').toLowerCase().trim(),
          key: step.key ? String(step.key) : undefined,
          label: step.label ? String(step.label) : undefined,
        };
      }
      if (type === 'tool') {
        const tool = String(step.tool || '').trim();
        if (!tool) return null;
        return {
          type: 'tool',
          tool,
          args: step.args && typeof step.args === 'object' ? step.args : {},
          as: step.as ? String(step.as) : undefined,
          key: step.key ? String(step.key) : undefined,
          label: step.label ? String(step.label) : undefined,
        };
      }
      if (type === 'compose' || type === 'deliver' || type === 'send') {
        return {
          type: type === 'send' ? 'deliver' : type,
          key: step.key ? String(step.key) : undefined,
          label: step.label ? String(step.label) : undefined,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function buildFlow(input) {
  const timezone = String(input.timezone || 'UTC').trim() || 'UTC';
  const channel = resolveChannel(input);
  const cadenceType = String(input.cadence_type || 'interval').toLowerCase() === 'monthly'
    ? 'monthly'
    : 'interval';
  const periods = parseStringList(input.periods);
  const metrics = parseStringList(input.metrics);
  const steps = parseSteps(input.steps);
  const prompt = String(input.prompt || input.intent || '').trim();
  const engineHint = String(input.engine || '').toLowerCase().trim();
  const messageTemplate = String(
    input.message_template || input.body || '',
  ).trim();
  // Every new schedule must use a deterministic process. A prompt is retained
  // only as human-readable intent/audit context; it is never re-run as Nova.
  const looksLikeInvoiceBriefing = /\b(invoice|sales|revenue|amount\s*paid|paid|sales\s+briefing|financial\s+briefing)\b/i.test(prompt);
  const wantsProcess = engineHint === 'process'
    || engineHint === 'flow'
    || engineHint === 'steps'
    || steps.length > 0
    || periods.length > 0
    || metrics.length > 0
    || String(input.data_source || '').toLowerCase() === 'invoice_report'
    || looksLikeInvoiceBriefing;
  const inferredPeriods = periods.length
    ? periods
    : [
      /\b(today|daily|day)\b/i.test(prompt) ? 'today' : null,
      /\b(month[- ]to[- ]date|mtd|month)\b/i.test(prompt) ? 'mtd' : null,
      /\b(quarter[- ]to[- ]date|qtd|quarter)\b/i.test(prompt) ? 'qtd' : null,
    ].filter(Boolean);
  const inferredMetrics = metrics.length
    ? metrics
    : [
      /\b(sales|revenue|invoiced|cumulative)\b/i.test(prompt) ? 'sales' : null,
      /\b(amount\s*paid|paid|payments?)\b/i.test(prompt) ? 'amount_paid' : null,
    ].filter(Boolean);
  const wantsInvoiceProcess = wantsProcess && (
    String(input.data_source || '').toLowerCase() === 'invoice_report'
    || inferredPeriods.length > 0
    || inferredMetrics.length > 0
    || looksLikeInvoiceBriefing
  );
  const requestedPrompt = prompt
    || (!wantsProcess && !messageTemplate && String(input.message || '').trim())
    || '';

  const flow = {
    recipients: parseRecipients(input.recipients),
    channel,
    timezone,
    cadence_type: cadenceType,
    subject_template: String(input.subject_template || input.subject || '').trim(),
    message_template: messageTemplate,
  };

  if (wantsProcess) {
    flow.engine = 'process';
    if (steps.length) flow.steps = steps;
    if (inferredPeriods.length) flow.periods = inferredPeriods;
    if (inferredMetrics.length) flow.metrics = inferredMetrics;
    if (input.scope != null) flow.scope = String(input.scope).trim() || 'company_totals';
    if (wantsInvoiceProcess) flow.data_source = 'invoice_report';
    if (requestedPrompt) flow.intent = requestedPrompt;
  } else if (messageTemplate) {
    // Send-only reminder (no agent turn)
    flow.engine = 'send_only';
  } else if (requestedPrompt) {
    // Do not create a prompt-only schedule. Without a frozen tool plan the
    // next tick would have to call Nova again and could change its behavior.
    flow.engine = 'process';
    flow.intent = requestedPrompt;
  }

  return flow;
}

function validateRecipientsForChannel(channel, recipients) {
  if (!recipients.length) {
    return channel === 'sms'
      ? 'recipients required (E.164 phone numbers)'
      : 'recipients required (email addresses)';
  }
  if (channel === 'sms') {
    const bad = recipients.filter((r) => !isE164(r));
    if (bad.length) {
      return `Invalid phone recipients (need E.164 like +15551234567): ${bad.slice(0, 3).join(', ')}`;
    }
    return null;
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const bad = recipients.filter((r) => !emailRe.test(r));
  if (bad.length) {
    return `Invalid email recipients: ${bad.slice(0, 3).join(', ')}`;
  }
  return null;
}

export function registerScribeTools() {
  registerTool(
    'scribe_create_schedule',
    {
      title: 'Create Scribe Schedule',
      description:
        'Schedule a frozen process on a timer. For reports, freeze the exact tool steps and normalized arguments '
        + 'selected during the chat turn; each tick re-runs those tools with only date placeholders changing, '
        + 'then uses the same compose and delivery steps. Use engine=process for every recurring task. '
        + 'Required: name, channel, recipients, frozen process steps (or periods/metrics shorthand), cadence. '
        + 'Optional subject_template (email fallback). '
        + 'Send-only (no Nova): message_template only. '
        + 'Confirm name, channel, recipients, prompt, cadence before calling.',
      inputSchema: {
        name: z.string().describe('Schedule display name'),
        description: z.string().optional().describe('Optional description'),
        flow_type: z
          .enum(['scheduled_message', 'sales_email_briefing'])
          .optional()
          .describe('Use scheduled_message (sales_email_briefing is a legacy alias)'),
        channel: z
          .enum(['email', 'sms'])
          .optional()
          .describe('Delivery channel (default email). sms → E.164 recipients via Telnyx'),
        recipients: z
          .array(z.string())
          .min(1)
          .describe('Emails when channel=email; E.164 phones when channel=sms'),
        prompt: z
          .string()
          .optional()
          .describe(
            'Human-readable intent only; never use a prompt as a substitute for frozen process steps.',
          ),
        intent: z.string().optional().describe('Alias for prompt'),
        engine: z
          .enum(['nova', 'process', 'send_only'])
          .optional()
          .describe('Always use process. Nova is not run during scheduled ticks.'),
        subject_template: z
          .string()
          .optional()
          .describe('Email subject (also used as SMS label). Supports {{date}} {{name}}'),
        message_template: z
          .string()
          .optional()
          .describe('Frozen body for send-only reminders (no Nova turn).'),
        steps: z
          .array(z.record(z.any()))
          .optional()
          .describe('Frozen execution steps: tool or invoice_report, followed by compose and deliver.'),
        periods: z
          .array(z.string())
          .optional()
          .describe('Invoice report windows: today, mtd, qtd'),
        metrics: z
          .array(z.string())
          .optional()
          .describe('Invoice metrics: sales, amount_paid'),
        scope: z.string().optional().describe('Legacy label e.g. company_totals'),
        data_source: z.string().optional().describe('Legacy: invoice_report'),
        timezone: z.string().optional().describe('IANA timezone, e.g. America/New_York'),
        cadence_type: z
          .enum(['interval', 'monthly'])
          .optional()
          .describe('interval (default) or monthly'),
        interval_days: z.number().optional().describe('When cadence_type=interval: every N days'),
        run_at_hour_utc: z.number().optional().describe('When cadence_type=interval: hour UTC 0-23'),
        day_of_month: z.number().optional().describe('When cadence_type=monthly: 1-28'),
        run_at_hour_local: z
          .number()
          .optional()
          .describe('When cadence_type=monthly: local hour 0-23 in timezone'),
        conversation_id: z.string().optional().describe('Nova conversation id that created this'),
        active: z.boolean().optional().describe('Start active (default true)'),
      },
      capabilities: { domain: 'scribe', action: 'create', safety: 'write' },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const flowType = String(input.flow_type || 'scheduled_message');
      if (!SUPPORTED_FLOW_TYPES.has(flowType)) {
        return asText({
          success: false,
          error: `Unsupported flow_type. Supported: ${[...SUPPORTED_FLOW_TYPES].join(', ')}`,
        });
      }
      const flow = buildFlow(input);
      const hasNova = flow.engine === 'nova' && Boolean(flow.prompt);
      const hasProcess = Boolean(
        (flow.steps && flow.steps.length)
        || (flow.periods && flow.periods.length)
        || (flow.metrics && flow.metrics.length)
        || flow.data_source === 'invoice_report',
      );
      if (!hasNova && !flow.message_template && !hasProcess) {
        return asText({
          success: false,
          error:
            'A recurring schedule must include frozen steps (tool name + args), periods/metrics, '
            + 'or message_template for a send-only reminder. A prompt alone is not schedulable. '
            + 'For tool work, retry with steps like [{"type":"tool","tool":"list_invoices",'
            + '"args":{"from_date":"{{today}}","to_date":"{{today}}"},"as":"invoices"},'
            + '{"type":"compose"},{"type":"deliver"}].',
        });
      }
      const recipientError = validateRecipientsForChannel(flow.channel, flow.recipients);
      if (recipientError) {
        return asText({ success: false, error: recipientError });
      }

      const activeCount = await ScheduleDefinition.countDocuments(activeQuery(
        ownerFilter(companyId, userId, { kind: 'flow_recipe', active: true }),
      ));
      const active = input.active !== false;
      if (active && activeCount >= MAX_ACTIVE_FLOW_SCHEDULES) {
        return asText({
          success: false,
          error: `Active schedule limit reached (${MAX_ACTIVE_FLOW_SCHEDULES}). Pause or delete one first.`,
        });
      }

      const isMonthly = flow.cadence_type === 'monthly';
      const cadence_type = isMonthly ? 'monthly' : 'interval';
      const interval_days = Math.min(90, Math.max(1, Math.round(Number(input.interval_days) || 1)));
      const run_at_hour_utc = Math.min(
        23,
        Math.max(0, Math.round(Number(input.run_at_hour_utc ?? 23))),
      );
      const day_of_month = isMonthly
        ? Math.min(28, Math.max(1, Math.round(Number(input.day_of_month) || 1)))
        : null;
      const run_at_hour_local = isMonthly
        ? Math.min(23, Math.max(0, Math.round(Number(input.run_at_hour_local ?? 9))))
        : null;

      const cadenceFields = {
        cadence_type,
        interval_days,
        run_at_hour_utc,
        day_of_month,
        run_at_hour_local,
        timezone: flow.timezone,
      };

      const doc = await ScheduleDefinition.create({
        company_id: String(companyId),
        user_id: String(userId),
        name: String(input.name || '').trim(),
        description: String(input.description || '').trim(),
        kind: 'flow_recipe',
        source: 'nova',
        conversation_id: input.conversation_id ? String(input.conversation_id) : null,
        flow_type: flowType === 'sales_email_briefing' ? 'scheduled_message' : flowType,
        flow,
        ...cadenceFields,
        active,
        next_run_at: computeFlowNextRunAt(cadenceFields),
      });

      return asText({
        success: true,
        message:
          `Scribe owns schedule "${doc.name}" `
          + `(${flow.channel}, ${cadence_type}`
          + `${flow.engine === 'nova' ? ', Nova agent each tick' : ''}).`,
        data: definitionToApi(doc),
      });
    },
  );

  registerTool(
    'scribe_list_schedules',
    {
      title: 'List Scribe Schedules',
      description:
        'List Scribe schedules for this user+company (same scope as conversations).',
      inputSchema: {
        kind: z
          .enum(['flow_recipe', 'criteria_report', 'all'])
          .optional()
          .describe('Filter by kind (default flow_recipe)'),
        active_only: z.boolean().optional().describe('Only active schedules'),
        limit: z.number().optional().describe('Max rows (default 25)'),
      },
      capabilities: { domain: 'scribe', action: 'list', safety: 'read' },
    },
    async (input = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const kind = input.kind || 'flow_recipe';
      const filter = ownerFilter(companyId, userId);
      if (kind !== 'all') filter.kind = kind;
      if (input.active_only) filter.active = true;
      const q = activeQuery(filter);
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 25));
      const rows = await ScheduleDefinition.find(q).sort({ updated_at: -1 }).limit(limit);
      return asText({
        success: true,
        count: rows.length,
        data: rows.map(definitionToApi),
      });
    },
  );

  registerTool(
    'scribe_pause_schedule',
    {
      title: 'Pause Scribe Schedule',
      description: 'Pause a Scribe schedule so the tick skips it until resumed.',
      inputSchema: {
        schedule_id: z.string().describe('Schedule id from scribe_list_schedules / create'),
      },
      capabilities: { domain: 'scribe', action: 'update', safety: 'write' },
    },
    async ({ schedule_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery(
        ownerFilter(companyId, userId, { _id: schedule_id }),
      ));
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      doc.active = false;
      await doc.save();
      return asText({ success: true, data: definitionToApi(doc) });
    },
  );

  registerTool(
    'scribe_resume_schedule',
    {
      title: 'Resume Scribe Schedule',
      description: 'Resume a paused Scribe schedule and recompute next_run_at.',
      inputSchema: {
        schedule_id: z.string().describe('Schedule id'),
      },
      capabilities: { domain: 'scribe', action: 'update', safety: 'write' },
    },
    async ({ schedule_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery(
        ownerFilter(companyId, userId, { _id: schedule_id }),
      ));
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      if (isFlowRecipe(doc)) {
        const activeCount = await ScheduleDefinition.countDocuments(activeQuery(
          ownerFilter(companyId, userId, {
            kind: 'flow_recipe',
            active: true,
            _id: { $ne: doc._id },
          }),
        ));
        if (activeCount >= MAX_ACTIVE_FLOW_SCHEDULES) {
          return asText({
            success: false,
            error: `Active schedule limit reached (${MAX_ACTIVE_FLOW_SCHEDULES})`,
          });
        }
      }
      doc.active = true;
      doc.next_run_at = isFlowRecipe(doc)
        ? computeFlowNextRunAt(doc)
        : computeNextRunAt(doc);
      await doc.save();
      return asText({ success: true, data: definitionToApi(doc) });
    },
  );

  registerTool(
    'scribe_delete_schedule',
    {
      title: 'Delete Scribe Schedule',
      description: 'Soft-delete a Scribe schedule (stops future runs). Run history is kept.',
      inputSchema: {
        schedule_id: z.string().describe('Schedule id'),
      },
      capabilities: { domain: 'scribe', action: 'delete', safety: 'write' },
    },
    async ({ schedule_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(
        ownerFilter(companyId, userId, { _id: schedule_id }),
      );
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      doc.deleted_at = new Date();
      doc.active = false;
      await doc.save();
      return asText({ success: true, data: { id: String(doc._id) } });
    },
  );

  registerTool(
    'scribe_update_schedule',
    {
      title: 'Update Scribe Schedule',
      description:
        'Update a Scribe schedule (name, channel, recipients, prompt, message, cadence). '
        + 'Does not change flow_type.',
      inputSchema: {
        schedule_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        channel: z.enum(['email', 'sms']).optional(),
        recipients: z.array(z.string()).optional(),
        prompt: z.string().optional().describe('Nova work prompt each tick'),
        engine: z.enum(['nova', 'process', 'send_only']).optional(),
        subject_template: z.string().optional(),
        message_template: z.string().optional(),
        steps: z.array(z.record(z.any())).optional(),
        periods: z.array(z.string()).optional(),
        metrics: z.array(z.string()).optional(),
        scope: z.string().optional(),
        data_source: z.string().optional(),
        timezone: z.string().optional(),
        cadence_type: z.enum(['interval', 'monthly']).optional(),
        interval_days: z.number().optional(),
        run_at_hour_utc: z.number().optional(),
        day_of_month: z.number().optional(),
        run_at_hour_local: z.number().optional(),
        active: z.boolean().optional(),
      },
      capabilities: { domain: 'scribe', action: 'update', safety: 'write' },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery(
        ownerFilter(companyId, userId, { _id: input.schedule_id }),
      ));
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      if (!isFlowRecipe(doc)) {
        return asText({
          success: false,
          error: 'scribe_update_schedule only supports flow_recipe schedules',
        });
      }

      if (input.name != null) doc.name = String(input.name).trim();
      if (input.description != null) doc.description = String(input.description).trim();
      if (input.active != null) doc.active = Boolean(input.active);

      const flow = { ...(doc.flow && typeof doc.flow === 'object' ? doc.flow : {}) };
      if (input.channel != null) {
        flow.channel = String(input.channel).toLowerCase() === 'sms' ? 'sms' : 'email';
      }
      if (input.recipients) flow.recipients = parseRecipients(input.recipients);
      if (input.timezone != null) {
        flow.timezone = String(input.timezone).trim() || 'UTC';
        doc.timezone = flow.timezone;
      }
      if (input.subject_template != null) {
        flow.subject_template = String(input.subject_template).trim();
      }
      if (input.message_template != null) {
        flow.message_template = String(input.message_template).trim();
      }
      if (input.prompt != null) {
        const nextPrompt = String(input.prompt).trim();
        if (nextPrompt) {
          flow.intent = nextPrompt;
        } else {
          delete flow.intent;
        }
      }
      if (input.engine != null) {
        const requestedEngine = String(input.engine).toLowerCase().trim();
        if (requestedEngine === 'nova') {
          return asText({
            success: false,
            error: 'Nova cannot be used for scheduled ticks. Keep engine=process and provide frozen steps.',
          });
        }
        flow.engine = requestedEngine === 'send_only' ? 'send_only' : 'process';
      }
      if (input.steps != null) {
        const steps = parseSteps(input.steps);
        if (steps.length) {
          flow.steps = steps;
          flow.engine = 'process';
        } else delete flow.steps;
      }
      if (input.periods != null) {
        const periods = parseStringList(input.periods);
        if (periods.length) {
          flow.periods = periods;
          flow.engine = 'process';
        } else delete flow.periods;
      }
      if (input.metrics != null) {
        const metrics = parseStringList(input.metrics);
        if (metrics.length) flow.metrics = metrics;
        else delete flow.metrics;
      }
      if (input.scope != null) flow.scope = String(input.scope).trim() || 'company_totals';
      if (input.data_source != null) {
        flow.data_source = String(input.data_source).trim().toLowerCase();
      }
      const hasFrozenWork = Boolean(
        (Array.isArray(flow.steps) && flow.steps.length)
        || (Array.isArray(flow.periods) && flow.periods.length)
        || (Array.isArray(flow.metrics) && flow.metrics.length)
        || flow.data_source === 'invoice_report',
      );
      if (flow.engine !== 'send_only' && !hasFrozenWork) {
        return asText({
          success: false,
          error: 'A recurring schedule must retain frozen steps or periods/metrics; a prompt alone is not schedulable.',
        });
      }
      if (input.cadence_type != null) {
        const cadence = String(input.cadence_type).toLowerCase() === 'monthly' ? 'monthly' : 'interval';
        flow.cadence_type = cadence;
        doc.cadence_type = cadence;
      }
      doc.flow = flow;
      doc.markModified('flow');

      if (input.interval_days != null) {
        doc.interval_days = Math.min(90, Math.max(1, Math.round(Number(input.interval_days) || 1)));
      }
      if (input.run_at_hour_utc != null) {
        doc.run_at_hour_utc = Math.min(23, Math.max(0, Math.round(Number(input.run_at_hour_utc))));
      }
      if (input.day_of_month != null) {
        doc.day_of_month = Math.min(28, Math.max(1, Math.round(Number(input.day_of_month) || 1)));
      }
      if (input.run_at_hour_local != null) {
        doc.run_at_hour_local = Math.min(23, Math.max(0, Math.round(Number(input.run_at_hour_local))));
      }
      doc.next_run_at = computeFlowNextRunAt(doc);
      await doc.save();
      return asText({ success: true, data: definitionToApi(doc) });
    },
  );

  registerTool(
    'scribe_run_schedule_now',
    {
      title: 'Run Scribe Schedule Now',
      description:
        'Trigger an immediate Scribe run of a frozen schedule (same flow as the tick). '
        + 'Returns a pending run id — check scribe_get_schedule_run for status/errors.',
      inputSchema: {
        schedule_id: z.string().describe('Schedule id'),
      },
      capabilities: { domain: 'scribe', action: 'create', safety: 'write' },
    },
    async ({ schedule_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery(
        ownerFilter(companyId, userId, { _id: schedule_id }),
      ));
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      const run = await queueScheduleDefinition(doc, {
        companyId: String(companyId),
        userId: String(userId),
        trigger: 'manual',
      });
      return asText({
        success: true,
        message: 'Run queued. Use scribe_get_schedule_run with the run id for status.',
        data: runDetailToApi(run),
      });
    },
  );

  registerTool(
    'scribe_list_schedule_runs',
    {
      title: 'List Scribe Schedule Runs',
      description:
        'List Mongo run logs for this user\'s schedules. Includes status, steps, errors.',
      inputSchema: {
        schedule_id: z.string().optional().describe('Filter by schedule id'),
        status: z.enum(['running', 'completed', 'error', 'partial']).optional(),
        limit: z.number().optional().describe('Max rows (default 20)'),
      },
      capabilities: { domain: 'scribe', action: 'list', safety: 'read' },
    },
    async (input = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      // Scope via owned definitions (legacy runs may omit user_id).
      const ownedDefs = await ScheduleDefinition.find(
        activeQuery(ownerFilter(companyId, userId)),
      ).select('_id').lean();
      const ownedIds = ownedDefs.map((d) => d._id);
      if (!ownedIds.length) {
        return asText({ success: true, count: 0, data: [] });
      }
      const base = {
        company_id: String(companyId),
        definition_id: { $in: ownedIds },
      };
      if (input.schedule_id) {
        const owned = ownedDefs.find((d) => String(d._id) === String(input.schedule_id));
        if (!owned) return asText({ success: false, error: 'Schedule not found' });
        base.definition_id = owned._id;
      }
      if (input.status) base.status = input.status;
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
      const rows = await ScheduleRun.find(activeQuery(base))
        .sort({ generated_at: -1 })
        .limit(limit);
      return asText({
        success: true,
        count: rows.length,
        data: rows.map(runToApi),
      });
    },
  );

  registerTool(
    'scribe_get_schedule_run',
    {
      title: 'Get Scribe Schedule Run',
      description:
        'Get one schedule run log from Mongo (steps, delivery, error_message / failed_step).',
      inputSchema: {
        run_id: z.string().describe('Run id from list or run_now'),
      },
      capabilities: { domain: 'scribe', action: 'get', safety: 'read' },
    },
    async ({ run_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const doc = await ScheduleRun.findOne(activeQuery({
        _id: run_id,
        company_id: String(companyId),
      }));
      if (!doc) return asText({ success: false, error: 'Run not found' });
      const owned = await ScheduleDefinition.findOne(activeQuery(
        ownerFilter(companyId, userId, { _id: doc.definition_id }),
      ));
      if (!owned) return asText({ success: false, error: 'Run not found' });
      return asText({ success: true, data: runDetailToApi(doc) });
    },
  );
}
