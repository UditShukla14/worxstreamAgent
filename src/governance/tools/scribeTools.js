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

function parseRecipients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function resolveChannel(input) {
  const raw = String(input.channel || 'email').toLowerCase().trim();
  return raw === 'sms' ? 'sms' : 'email';
}

function buildFlow(input) {
  const timezone = String(input.timezone || 'UTC').trim() || 'UTC';
  const channel = resolveChannel(input);
  const cadenceType = String(input.cadence_type || 'interval').toLowerCase() === 'monthly'
    ? 'monthly'
    : 'interval';
  return {
    recipients: parseRecipients(input.recipients),
    channel,
    timezone,
    cadence_type: cadenceType,
    subject_template: String(input.subject_template || input.subject || '').trim(),
    message_template: String(input.message_template || input.body || input.message || '').trim(),
  };
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
        'Hand any recurring notification to Scribe. Freezes channel + recipients + message — '
        + 'Scribe sends on cadence with no LLM on the tick. '
        + 'flow_type: scheduled_message. '
        + 'channel: email or sms. '
        + 'SMS uses Telnyx on the tick (not draft_sms/send_sms chat confirms) — freeze E.164 phones. '
        + 'Email uses send_email. '
        + 'Cadence: interval (days + UTC hour) or monthly (day_of_month + local hour in timezone). '
        + 'message_template / subject_template support {{date}} and {{name}}. '
        + 'Clarify content with the user first (pull live data in chat if needed, then freeze the message). '
        + 'Confirm name, channel, recipients, message, and cadence before calling.',
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
        subject_template: z
          .string()
          .optional()
          .describe('Email subject (also used as SMS label). Supports {{date}} {{name}}'),
        message_template: z
          .string()
          .describe('Frozen message body. Supports {{date}} {{name}}. For SMS keep it short.'),
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
      if (!flow.message_template) {
        return asText({
          success: false,
          error: 'message_template is required (freeze the message text to send each run)',
        });
      }
      const recipientError = validateRecipientsForChannel(flow.channel, flow.recipients);
      if (recipientError) {
        return asText({ success: false, error: recipientError });
      }

      const activeCount = await ScheduleDefinition.countDocuments(activeQuery({
        company_id: String(companyId),
        kind: 'flow_recipe',
        active: true,
      }));
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
          + `(${flow.channel}, ${cadence_type}).`,
        data: definitionToApi(doc),
      });
    },
  );

  registerTool(
    'scribe_list_schedules',
    {
      title: 'List Scribe Schedules',
      description: 'List Scribe schedules (flow recipes and/or criteria reports) for this company.',
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
      const { companyId } = getWorxstreamContext();
      const kind = input.kind || 'flow_recipe';
      const filter = { company_id: String(companyId) };
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
      const { companyId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery({
        _id: schedule_id,
        company_id: String(companyId),
      }));
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
      const { companyId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery({
        _id: schedule_id,
        company_id: String(companyId),
      }));
      if (!doc) return asText({ success: false, error: 'Schedule not found' });
      if (isFlowRecipe(doc)) {
        const activeCount = await ScheduleDefinition.countDocuments(activeQuery({
          company_id: String(companyId),
          kind: 'flow_recipe',
          active: true,
          _id: { $ne: doc._id },
        }));
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
      const { companyId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne({
        _id: schedule_id,
        company_id: String(companyId),
      });
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
        'Update a Scribe flow schedule (name, channel, recipients, message, cadence). '
        + 'Does not change flow_type.',
      inputSchema: {
        schedule_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        channel: z.enum(['email', 'sms']).optional(),
        recipients: z.array(z.string()).optional(),
        subject_template: z.string().optional(),
        message_template: z.string().optional(),
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
      const { companyId } = getWorxstreamContext();
      const doc = await ScheduleDefinition.findOne(activeQuery({
        _id: input.schedule_id,
        company_id: String(companyId),
      }));
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
      const doc = await ScheduleDefinition.findOne(activeQuery({
        _id: schedule_id,
        company_id: String(companyId),
      }));
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
        'List Mongo run logs for a schedule (or all company runs). Includes status, steps, errors.',
      inputSchema: {
        schedule_id: z.string().optional().describe('Filter by schedule id'),
        status: z.enum(['running', 'completed', 'error', 'partial']).optional(),
        limit: z.number().optional().describe('Max rows (default 20)'),
      },
      capabilities: { domain: 'scribe', action: 'list', safety: 'read' },
    },
    async (input = {}) => {
      const { companyId } = getWorxstreamContext();
      const base = { company_id: String(companyId) };
      if (input.schedule_id) {
        const owned = await ScheduleDefinition.findOne(activeQuery({
          _id: input.schedule_id,
          company_id: String(companyId),
        }));
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
      const { companyId } = getWorxstreamContext();
      const doc = await ScheduleRun.findOne(activeQuery({
        _id: run_id,
        company_id: String(companyId),
      }));
      if (!doc) return asText({ success: false, error: 'Run not found' });
      return asText({ success: true, data: runDetailToApi(doc) });
    },
  );
}
