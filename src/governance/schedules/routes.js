/**
 * Control Tower report / schedule APIs — definitions and generated runs.
 * Supports criteria_report and flow_recipe (Nova → Scribe).
 */

import { Router } from 'express';
import ScheduleDefinition from '../models/ScheduleDefinition.js';
import ScheduleRun from '../models/ScheduleRun.js';
import {
  computeNextRunAt,
  queueScheduleDefinition,
} from './engine.js';
import {
  MAX_ACTIVE_FLOW_SCHEDULES,
  SUPPORTED_FLOW_TYPES,
  computeFlowNextRunAt,
  isFlowRecipe,
  resolveFlowSteps,
} from './flowEngine.js';

function activeQuery(filter) {
  return {
    $and: [
      filter,
      { $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
    ],
  };
}

function definitionToApi(doc) {
  const kind = doc.kind === 'flow_recipe' || doc.flow_type ? 'flow_recipe' : 'criteria_report';
  const flow = doc.flow && typeof doc.flow === 'object' ? { ...doc.flow } : null;
  if (flow && flow.engine === 'process' && (!Array.isArray(flow.steps) || flow.steps.length === 0)) {
    flow.steps = resolveFlowSteps(flow).map((step) => ({
      type: step.type,
      key: step.key,
      label: step.label,
      ...(step.period ? { period: step.period } : {}),
      ...(step.tool ? { tool: step.tool } : {}),
      ...(step.args ? { args: step.args } : {}),
      ...(step.as ? { as: step.as } : {}),
    }));
  }
  return {
    id: String(doc._id),
    companyId: String(doc.company_id),
    userId: doc.user_id != null && doc.user_id !== '' ? String(doc.user_id) : null,
    name: doc.name,
    description: doc.description || '',
    kind,
    source: doc.source || (kind === 'flow_recipe' ? 'nova' : 'control_tower'),
    conversationId: doc.conversation_id || null,
    entityTypes: doc.entity_types || [],
    criteriaType: doc.criteria_type || null,
    criteriaFields: doc.criteria_fields || [],
    flowType: doc.flow_type || null,
    flow,
    timezone: doc.timezone || 'UTC',
    cadenceType: doc.cadence_type || 'interval',
    intervalDays: doc.interval_days,
    runAtHourUtc: doc.run_at_hour_utc,
    dayOfMonth: doc.day_of_month ?? null,
    runAtHourLocal: doc.run_at_hour_local ?? null,
    active: Boolean(doc.active),
    lastRunAt: doc.last_run_at ? new Date(doc.last_run_at).toISOString() : null,
    nextRunAt: doc.next_run_at ? new Date(doc.next_run_at).toISOString() : null,
    updatedAt: (doc.updated_at || doc.created_at || new Date()).toISOString(),
  };
}

function progressToApi(doc) {
  const progress = doc.progress || { phase: 'starting', steps: [] };
  return {
    phase: progress.phase || 'starting',
    steps: (progress.steps || []).map((step) => ({
      key: step.key,
      label: step.label,
      status: step.status,
      detail: step.detail || '',
      outputSummary: step.output_summary,
      at: step.at ? new Date(step.at).toISOString() : new Date().toISOString(),
    })),
  };
}

function deliveryToApi(doc) {
  const d = doc.delivery;
  if (!d || (!d.channel && !(d.to && d.to.length) && !d.subject && !d.status)) {
    return null;
  }
  return {
    channel: d.channel || '',
    to: Array.isArray(d.to) ? d.to : [],
    subject: d.subject || '',
    status: d.status || '',
    providerId: d.provider_id || '',
    detail: d.detail || '',
  };
}

function runToApi(doc) {
  return {
    id: String(doc._id),
    companyId: String(doc.company_id),
    definitionId: String(doc.definition_id),
    definitionName: doc.definition_name || '',
    kind: doc.kind || 'criteria_report',
    flowType: doc.flow_type || null,
    conversationId: doc.conversation_id || null,
    periodStart: new Date(doc.period_start).toISOString(),
    periodEnd: new Date(doc.period_end).toISOString(),
    status: doc.status,
    summary: doc.summary || { scanned: 0, matched: 0, estimates: 0, invoices: 0 },
    rowCount: Array.isArray(doc.rows) ? doc.rows.length : 0,
    errorMessage: doc.error_message || '',
    errorCode: doc.error_code || '',
    failedStep: doc.failed_step || '',
    startedAt: doc.started_at ? new Date(doc.started_at).toISOString() : null,
    finishedAt: doc.finished_at ? new Date(doc.finished_at).toISOString() : null,
    delivery: deliveryToApi(doc),
    generatedAt: (doc.generated_at || doc.created_at || new Date()).toISOString(),
    trigger: doc.trigger === 'scheduled' ? 'scheduled' : 'manual',
    progress: progressToApi(doc),
  };
}

function runDetailToApi(doc) {
  return {
    ...runToApi(doc),
    errorStack: doc.error_stack || '',
    rows: (doc.rows || []).map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      label: row.label,
      customerName: row.customer_name,
      reason: row.reason,
      snapshot: row.snapshot || {},
    })),
  };
}

function parseListPage(req, defaultPerPage = 20) {
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.per_page || req.query.limit || String(defaultPerPage)), 10) || defaultPerPage),
  );
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  return { page, perPage };
}

function clampListPage(page, perPage, total) {
  const lastPage = Math.max(1, Math.ceil(total / perPage) || 1);
  const currentPage = page > lastPage ? lastPage : page;
  return {
    skip: (currentPage - 1) * perPage,
    pagination: { currentPage, lastPage, perPage, total },
  };
}

function parseEntityTypes(body) {
  const raw = body.entityTypes ?? body.entity_types;
  if (!Array.isArray(raw)) return ['estimate', 'invoice'];
  const allowed = raw.map((item) => String(item).trim()).filter((item) => item === 'estimate' || item === 'invoice');
  return allowed.length > 0 ? allowed : ['estimate', 'invoice'];
}

function parseCriteriaFields(body) {
  const raw = body.criteriaFields ?? body.criteria_fields;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function parseRecipients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function parseStringList(raw, fallback = []) {
  if (!Array.isArray(raw)) return fallback;
  return raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

function normalizeStoredFlow(flow) {
  const next = flow && typeof flow === 'object' ? { ...flow } : {};
  if (String(next.engine || '').toLowerCase() === 'process') {
    next.steps = resolveFlowSteps(next).map((step) => ({
      type: step.type,
      key: step.key,
      label: step.label,
      ...(step.period ? { period: step.period } : {}),
      ...(step.tool ? { tool: step.tool } : {}),
      ...(step.args ? { args: step.args } : {}),
      ...(step.as ? { as: step.as } : {}),
    }));
  }
  return next;
}

function flowFromBody(body) {
  const flowIn = body.flow && typeof body.flow === 'object' ? body.flow : {};
  const recipients = parseRecipients(
    flowIn.recipients ?? body.recipients ?? body.mail_to ?? body.mailTo,
  );
  const timezone = String(flowIn.timezone ?? body.timezone ?? 'UTC').trim() || 'UTC';
  const channelRaw = String(flowIn.channel ?? body.channel ?? 'email').toLowerCase().trim();
  const cadenceRaw = String(
    flowIn.cadence_type ?? body.cadenceType ?? body.cadence_type ?? 'interval',
  ).toLowerCase();
  const flow = {
    recipients,
    channel: channelRaw === 'sms' ? 'sms' : 'email',
    timezone,
    cadence_type: cadenceRaw === 'monthly' ? 'monthly' : 'interval',
    subject_template: String(
      flowIn.subject_template ?? flowIn.subjectTemplate ?? body.subject_template ?? body.subject ?? '',
    ).trim(),
    message_template: String(
      flowIn.message_template
      ?? flowIn.messageTemplate
      ?? flowIn.body
      ?? body.message_template
      ?? body.body
      ?? '',
    ).trim(),
  };
  const engine = String(flowIn.engine ?? body.engine ?? '').toLowerCase().trim();
  const prompt = String(flowIn.prompt ?? flowIn.intent ?? body.prompt ?? body.intent ?? '').trim();
  const steps = flowIn.steps ?? body.steps;
  const periods = flowIn.periods ?? body.periods;
  const metrics = flowIn.metrics ?? body.metrics;
  if (engine) flow.engine = engine;
  if (prompt) flow.intent = prompt;
  if (Array.isArray(steps)) flow.steps = steps;
  if (Array.isArray(periods)) flow.periods = parseStringList(periods);
  if (Array.isArray(metrics)) flow.metrics = parseStringList(metrics);
  if (!flow.engine && (
    (Array.isArray(flow.steps) && flow.steps.length > 0)
    || (Array.isArray(flow.periods) && flow.periods.length > 0)
    || (Array.isArray(flow.metrics) && flow.metrics.length > 0)
  )) {
    flow.engine = 'process';
  } else if (!flow.engine && flow.message_template) {
    flow.engine = 'send_only';
  }
  if (flowIn.scope != null || body.scope != null) flow.scope = String(flowIn.scope ?? body.scope).trim();
  if (flowIn.data_source != null || body.data_source != null) {
    flow.data_source = String(flowIn.data_source ?? body.data_source).trim().toLowerCase();
  }
  return normalizeStoredFlow(flow);
}

function definitionFieldsFromBody(body, partial = false) {
  const out = {};
  const kindRaw = String(body.kind ?? body.schedule_kind ?? '').trim();
  const flowTypeRaw = String(body.flowType ?? body.flow_type ?? '').trim();
  const isFlow = kindRaw === 'flow_recipe' || Boolean(flowTypeRaw) || Boolean(body.flow);

  if (!partial || body.kind != null || body.flowType != null || body.flow_type != null || body.flow != null) {
    if (isFlow) {
      out.kind = 'flow_recipe';
      out.source = String(body.source || 'nova').trim() === 'control_tower' ? 'control_tower' : 'nova';
    } else if (!partial || body.kind != null) {
      out.kind = 'criteria_report';
      out.source = String(body.source || 'control_tower').trim() === 'nova' ? 'nova' : 'control_tower';
    }
  }

  if (!partial || body.name != null) out.name = String(body.name || '').trim();
  if (!partial || body.description != null) out.description = String(body.description || '').trim();
  if (!partial || body.conversationId != null || body.conversation_id != null) {
    const cid = body.conversationId ?? body.conversation_id;
    out.conversation_id = cid != null && String(cid).trim() ? String(cid).trim() : null;
  }

  if (isFlow || out.kind === 'flow_recipe') {
    if (!partial || body.flowType != null || body.flow_type != null || body.flow != null || body.recipients != null) {
      let flowType = flowTypeRaw || 'scheduled_message';
      if (flowType === 'sales_email_briefing') flowType = 'scheduled_message';
      out.flow_type = flowType;
      out.flow = flowFromBody(body);
      out.timezone = out.flow.timezone;
      out.criteria_type = null;
      out.entity_types = [];
      out.criteria_fields = [];
      if (!partial || body.cadenceType != null || body.cadence_type != null) {
        out.cadence_type = out.flow.cadence_type;
      }
    }
  } else {
    if (!partial || body.entityTypes != null || body.entity_types != null) {
      out.entity_types = parseEntityTypes(body);
    }
    if (!partial || body.criteriaType != null || body.criteria_type != null) {
      const criteriaType = String(body.criteriaType ?? body.criteria_type ?? '').trim();
      if (criteriaType === 'missing_fields' || criteriaType === 'negative_profit') {
        out.criteria_type = criteriaType;
      }
    }
    if (!partial || body.criteriaFields != null || body.criteria_fields != null) {
      out.criteria_fields = parseCriteriaFields(body);
    }
  }

  if (!partial || body.intervalDays != null || body.interval_days != null) {
    const days = Number(body.intervalDays ?? body.interval_days);
    out.interval_days = Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : 1;
  }
  if (!partial || body.runAtHourUtc != null || body.run_at_hour_utc != null) {
    const hour = Number(body.runAtHourUtc ?? body.run_at_hour_utc);
    out.run_at_hour_utc = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : 23;
  }
  if (!partial || body.cadenceType != null || body.cadence_type != null) {
    const cadence = String(body.cadenceType ?? body.cadence_type ?? 'interval').toLowerCase();
    out.cadence_type = cadence === 'monthly' ? 'monthly' : 'interval';
  }
  if (!partial || body.dayOfMonth != null || body.day_of_month != null) {
    const day = Number(body.dayOfMonth ?? body.day_of_month);
    out.day_of_month = Number.isFinite(day) ? Math.min(28, Math.max(1, Math.round(day))) : 1;
  }
  if (!partial || body.runAtHourLocal != null || body.run_at_hour_local != null) {
    const hour = Number(body.runAtHourLocal ?? body.run_at_hour_local);
    out.run_at_hour_local = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : 9;
  }
  if (!partial || body.timezone != null) {
    out.timezone = String(body.timezone || 'UTC').trim() || 'UTC';
  }
  if (!partial || body.active != null) out.active = Boolean(body.active);
  return out;
}

function nextRunFor(fields, existing = null) {
  const stub = {
    cadence_type: fields.cadence_type ?? existing?.cadence_type ?? 'interval',
    interval_days: fields.interval_days ?? existing?.interval_days ?? 1,
    run_at_hour_utc: fields.run_at_hour_utc ?? existing?.run_at_hour_utc ?? 23,
    day_of_month: fields.day_of_month ?? existing?.day_of_month ?? 1,
    run_at_hour_local: fields.run_at_hour_local ?? existing?.run_at_hour_local ?? 9,
    timezone: fields.timezone ?? existing?.timezone ?? 'UTC',
  };
  if ((fields.kind || existing?.kind) === 'flow_recipe') {
    return computeFlowNextRunAt(stub);
  }
  return computeNextRunAt(stub);
}

export function createScheduleRouter() {
  const router = Router();

  router.get('/report-definitions', async (req, res, next) => {
    try {
      const filter = activeQuery({ company_id: req.companyId });
      if (req.query.kind) {
        filter.$and[0].kind = String(req.query.kind);
      }
      const { page, perPage } = parseListPage(req);
      const total = await ScheduleDefinition.countDocuments(filter);
      const sliced = clampListPage(page, perPage, total);
      const rows = await ScheduleDefinition.find(filter)
        .sort({ updated_at: -1 })
        .skip(sliced.skip)
        .limit(perPage);
      res.json({ success: true, data: rows.map(definitionToApi), pagination: sliced.pagination });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions', async (req, res, next) => {
    try {
      const fields = definitionFieldsFromBody(req.body || {}, false);
      if (!fields.name) {
        return res.status(400).json({ success: false, error: 'name is required' });
      }

      if (fields.kind === 'flow_recipe') {
        if (!SUPPORTED_FLOW_TYPES.has(fields.flow_type)) {
          return res.status(400).json({
            success: false,
            error: `Unsupported flowType. Supported: ${[...SUPPORTED_FLOW_TYPES].join(', ')}`,
          });
        }
        if (!fields.flow?.recipients?.length) {
          return res.status(400).json({ success: false, error: 'flow.recipients is required' });
        }
        const activeCount = await ScheduleDefinition.countDocuments(activeQuery({
          company_id: req.companyId,
          kind: 'flow_recipe',
          active: true,
        }));
        if (activeCount >= MAX_ACTIVE_FLOW_SCHEDULES && fields.active !== false) {
          return res.status(400).json({
            success: false,
            error: `Active flow schedule limit reached (${MAX_ACTIVE_FLOW_SCHEDULES})`,
          });
        }
      } else {
        if (!fields.criteria_type) {
          return res.status(400).json({
            success: false,
            error: 'name and criteriaType are required',
          });
        }
        if (fields.criteria_type === 'missing_fields' && (!fields.criteria_fields || fields.criteria_fields.length === 0)) {
          fields.criteria_fields = ['trackingNo', 'trackingUrl', 'trackingCompany'];
        }
        fields.kind = 'criteria_report';
        fields.source = fields.source || 'control_tower';
      }

      const doc = await ScheduleDefinition.create({
        company_id: req.companyId,
        user_id: req.userId,
        ...fields,
        next_run_at: nextRunFor(fields),
      });
      res.status(201).json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/report-definitions/:id', async (req, res, next) => {
    try {
      const doc = await ScheduleDefinition.findOne({ _id: req.params.id, company_id: req.companyId });
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      const fields = definitionFieldsFromBody(req.body || {}, true);
      Object.assign(doc, fields);

      if (!doc.name) {
        return res.status(400).json({ success: false, error: 'name is required' });
      }

      if (isFlowRecipe(doc)) {
        doc.kind = 'flow_recipe';
        doc.flow = normalizeStoredFlow(doc.flow);
        if (!SUPPORTED_FLOW_TYPES.has(String(doc.flow_type || ''))) {
          return res.status(400).json({
            success: false,
            error: `Unsupported flowType. Supported: ${[...SUPPORTED_FLOW_TYPES].join(', ')}`,
          });
        }
        if (!doc.flow?.recipients?.length) {
          return res.status(400).json({ success: false, error: 'flow.recipients is required' });
        }
      } else {
        if (!doc.criteria_type) {
          return res.status(400).json({ success: false, error: 'name and criteriaType are required' });
        }
        if (doc.criteria_type === 'missing_fields' && (!doc.criteria_fields || doc.criteria_fields.length === 0)) {
          doc.criteria_fields = ['trackingNo', 'trackingUrl', 'trackingCompany'];
        }
      }

      if (fields.interval_days != null || fields.run_at_hour_utc != null || fields.active != null || fields.flow != null) {
        doc.next_run_at = nextRunFor(fields, doc);
      }
      await doc.save();
      res.json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions/:id/pause', async (req, res, next) => {
    try {
      const doc = await ScheduleDefinition.findOne(activeQuery({ _id: req.params.id, company_id: req.companyId }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      doc.active = false;
      await doc.save();
      res.json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions/:id/resume', async (req, res, next) => {
    try {
      const doc = await ScheduleDefinition.findOne(activeQuery({ _id: req.params.id, company_id: req.companyId }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      if (isFlowRecipe(doc)) {
        const activeCount = await ScheduleDefinition.countDocuments(activeQuery({
          company_id: req.companyId,
          kind: 'flow_recipe',
          active: true,
          _id: { $ne: doc._id },
        }));
        if (activeCount >= MAX_ACTIVE_FLOW_SCHEDULES) {
          return res.status(400).json({
            success: false,
            error: `Active flow schedule limit reached (${MAX_ACTIVE_FLOW_SCHEDULES})`,
          });
        }
      }
      doc.active = true;
      doc.next_run_at = nextRunFor({}, doc);
      await doc.save();
      res.json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/report-definitions/:id', async (req, res, next) => {
    try {
      const doc = await ScheduleDefinition.findOne({ _id: req.params.id, company_id: req.companyId });
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      doc.deleted_at = new Date();
      doc.active = false;
      await doc.save();
      res.json({ success: true, data: { id: String(doc._id) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions/:id/run', async (req, res, next) => {
    try {
      const doc = await ScheduleDefinition.findOne(activeQuery({ _id: req.params.id, company_id: req.companyId }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      const run = await queueScheduleDefinition(doc, {
        companyId: req.companyId,
        userId: req.userId,
        trigger: 'manual',
      });
      res.status(202).json({ success: true, data: runDetailToApi(run) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report-runs', async (req, res, next) => {
    try {
      const base = { company_id: String(req.companyId) };
      if (req.query.definition_id) {
        const definitionId = String(req.query.definition_id);
        const owned = await ScheduleDefinition.findOne(activeQuery({
          _id: definitionId,
          company_id: req.companyId,
        }));
        if (!owned) {
          return res.status(404).json({ success: false, error: 'Report schedule not found' });
        }
        base.definition_id = owned._id;
      }
      if (req.query.kind) {
        base.kind = String(req.query.kind);
      }
      if (req.query.status) {
        base.status = String(req.query.status);
      }
      const filter = activeQuery(base);
      const { page, perPage } = parseListPage(req);
      const total = await ScheduleRun.countDocuments(filter);
      const sliced = clampListPage(page, perPage, total);
      const rows = await ScheduleRun.find(filter)
        .sort({ generated_at: -1 })
        .skip(sliced.skip)
        .limit(perPage);
      res.json({ success: true, data: rows.map(runToApi), pagination: sliced.pagination });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report-runs/:id', async (req, res, next) => {
    try {
      const doc = await ScheduleRun.findOne(activeQuery({
        _id: req.params.id,
        company_id: String(req.companyId),
      }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
      res.json({ success: true, data: runDetailToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/report-runs/:id', async (req, res, next) => {
    try {
      const doc = await ScheduleRun.findOne({
        _id: req.params.id,
        company_id: String(req.companyId),
      });
      if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
      doc.deleted_at = new Date();
      await doc.save();
      res.json({ success: true, data: { id: String(doc._id) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-runs/delete', async (req, res, next) => {
    try {
      const raw = req.body?.runIds ?? req.body?.run_ids ?? req.body?.ids;
      const runIds = Array.isArray(raw)
        ? raw.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (runIds.length === 0) {
        return res.status(400).json({ success: false, error: 'runIds is required' });
      }
      const result = await ScheduleRun.updateMany(
        {
          _id: { $in: runIds },
          company_id: String(req.companyId),
          $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
        },
        { $set: { deleted_at: new Date() } },
      );
      res.json({
        success: true,
        data: { deleted: result.modifiedCount ?? 0 },
      });
    } catch (error) {
      next(error);
    }
  });

  // Prefer /schedules* naming; keep /report-* for Control Tower compatibility.
  const aliasMap = [
    ['/report-definitions', '/schedules'],
    ['/report-runs', '/schedule-runs'],
  ];
  for (const layer of [...router.stack]) {
    if (!layer.route) continue;
    for (const [from, to] of aliasMap) {
      if (!layer.route.path.startsWith(from)) continue;
      const aliasPath = layer.route.path.replace(from, to);
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        const handlers = layer.route.stack.map((l) => l.handle);
        router[method](aliasPath, ...handlers);
      }
    }
  }

  return router;
}

export {
  definitionToApi,
  runToApi,
  runDetailToApi,
  activeQuery,
};
