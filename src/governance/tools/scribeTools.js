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

function parseStringList(raw, fallback = []) {
  if (!Array.isArray(raw)) return [...fallback];
  const list = raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return list.length > 0 ? list : [...fallback];
}

function buildFlow(input) {
  return {
    recipients: parseRecipients(input.recipients),
    metrics: parseStringList(input.metrics, ['sales', 'amount_paid']),
    periods: parseStringList(input.periods, ['today']),
    scope: String(input.scope || 'company_totals').trim() || 'company_totals',
    timezone: String(input.timezone || 'UTC').trim() || 'UTC',
    subject_template: String(input.subject_template || '').trim(),
  };
}

export function registerScribeTools() {
  registerTool(
    'scribe_create_schedule',
    {
      title: 'Create Scribe Schedule',
      description:
        'Hand a recurring job to Scribe (schedule manager). Freezes a structured flow — '
        + 'Scribe re-runs the same steps on cadence with fresh date values only (no LLM). '
        + 'v1 flow_type: sales_email_briefing (invoice totals → email). '
        + 'Confirm name, recipients, time, metrics, and periods with the user before calling.',
      inputSchema: {
        name: z.string().describe('Schedule display name, e.g. Daily briefing for sales'),
        description: z.string().optional().describe('Optional description'),
        flow_type: z
          .enum(['sales_email_briefing'])
          .describe('Frozen recipe type'),
        recipients: z.array(z.string().email()).min(1).describe('Email recipients'),
        metrics: z
          .array(z.string())
          .optional()
          .describe('Metrics: sales, amount_paid'),
        periods: z
          .array(z.string())
          .optional()
          .describe('Periods: today, mtd, qtd'),
        scope: z.string().optional().describe('company_totals (v1)'),
        timezone: z.string().optional().describe('IANA timezone, e.g. America/New_York'),
        interval_days: z.number().optional().describe('Run every N days (default 1)'),
        run_at_hour_utc: z.number().optional().describe('Hour UTC 0-23 (default 23 = EOD UTC)'),
        subject_template: z.string().optional().describe('Optional email subject override'),
        conversation_id: z.string().optional().describe('Nova conversation id that created this'),
        active: z.boolean().optional().describe('Start active (default true)'),
      },
      capabilities: { domain: 'scribe', action: 'create', safety: 'write' },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const flowType = String(input.flow_type || 'sales_email_briefing');
      if (!SUPPORTED_FLOW_TYPES.has(flowType)) {
        return asText({
          success: false,
          error: `Unsupported flow_type. Supported: ${[...SUPPORTED_FLOW_TYPES].join(', ')}`,
        });
      }
      const flow = buildFlow(input);
      if (flow.recipients.length === 0) {
        return asText({ success: false, error: 'recipients required' });
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

      const interval_days = Math.min(90, Math.max(1, Math.round(Number(input.interval_days) || 1)));
      const run_at_hour_utc = Math.min(
        23,
        Math.max(0, Math.round(Number(input.run_at_hour_utc ?? 23))),
      );

      const doc = await ScheduleDefinition.create({
        company_id: String(companyId),
        user_id: String(userId),
        name: String(input.name || '').trim(),
        description: String(input.description || '').trim(),
        kind: 'flow_recipe',
        source: 'nova',
        conversation_id: input.conversation_id ? String(input.conversation_id) : null,
        flow_type: flowType,
        flow,
        timezone: flow.timezone,
        interval_days,
        run_at_hour_utc,
        active,
        next_run_at: computeFlowNextRunAt({ interval_days, run_at_hour_utc }),
      });

      return asText({
        success: true,
        message: `Scribe owns schedule "${doc.name}". It will run the frozen ${flowType} flow on cadence.`,
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
        'Update a Scribe flow schedule (name, recipients, metrics, periods, cadence). '
        + 'Does not change flow_type.',
      inputSchema: {
        schedule_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        recipients: z.array(z.string().email()).optional(),
        metrics: z.array(z.string()).optional(),
        periods: z.array(z.string()).optional(),
        scope: z.string().optional(),
        timezone: z.string().optional(),
        interval_days: z.number().optional(),
        run_at_hour_utc: z.number().optional(),
        subject_template: z.string().optional(),
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
      if (input.recipients) flow.recipients = parseRecipients(input.recipients);
      if (input.metrics) flow.metrics = parseStringList(input.metrics, flow.metrics || ['sales', 'amount_paid']);
      if (input.periods) flow.periods = parseStringList(input.periods, flow.periods || ['today']);
      if (input.scope != null) flow.scope = String(input.scope).trim() || 'company_totals';
      if (input.timezone != null) {
        flow.timezone = String(input.timezone).trim() || 'UTC';
        doc.timezone = flow.timezone;
      }
      if (input.subject_template != null) {
        flow.subject_template = String(input.subject_template).trim();
      }
      doc.flow = flow;
      doc.markModified('flow');

      if (input.interval_days != null) {
        doc.interval_days = Math.min(90, Math.max(1, Math.round(Number(input.interval_days) || 1)));
      }
      if (input.run_at_hour_utc != null) {
        doc.run_at_hour_utc = Math.min(23, Math.max(0, Math.round(Number(input.run_at_hour_utc))));
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
