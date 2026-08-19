/**
 * Control Tower APIs — policies, rules, pipeline runs, alerts, dashboard.
 * All routes are scoped by company_id (query or body).
 */

import { Router } from 'express';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import PipelineRun from '../models/PipelineRun.js';
import GovernanceAlert from '../models/GovernanceAlert.js';
import HiddenWebhookDelivery from '../models/HiddenWebhookDelivery.js';
import WebhookDelivery from '../models/WebhookDelivery.js';
import {
  GOVERNANCE_AGENT_DEFINITIONS,
  getGovernanceAgentName,
  listPipelines,
  countActivePipelines,
  removeDocumentChunks,
  syncGovernanceDocumentChunks,
  stopPipelineRun,
  restartPipelineRun,
} from '../control/index.js';
import { callWorxstreamAPI } from '../services/httpClient.js';
import { customerTypeFromPayload } from '../control/contextBuilder.js';
import { eventTypesFromRule, parseRuleEventTypes, ruleChunkContent } from '../control/ruleEvents.js';

const router = Router();

function companyIdFromReq(req) {
  const raw = req.query.company_id
    ?? req.query.companyId
    ?? req.body?.company_id
    ?? req.body?.companyId;
  return raw != null && String(raw).trim() ? String(raw).trim() : '';
}

function userIdFromReq(req) {
  const raw = req.query.user_id
    ?? req.query.userId
    ?? req.body?.user_id
    ?? req.body?.userId;
  return raw != null && String(raw).trim() ? String(raw).trim() : '';
}

function requireCompanyId(req, res, next) {
  const companyId = companyIdFromReq(req);
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id is required' });
  }
  req.companyId = companyId;
  next();
}

router.use(requireCompanyId);

function policyToApi(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    type: doc.type,
    status: doc.status,
    content: doc.content,
    updatedAt: (doc.updated_at || doc.created_at || new Date()).toISOString(),
  };
}

function ruleToApi(doc) {
  const eventTypes = eventTypesFromRule(doc);
  return {
    id: String(doc._id),
    name: doc.name,
    eventType: eventTypes[0] || doc.event_type,
    eventTypes,
    condition: doc.condition,
    action: doc.action,
    priority: doc.priority,
    active: Boolean(doc.active),
    updatedAt: (doc.updated_at || doc.created_at || new Date()).toISOString(),
  };
}

function runToApi(doc) {
  return {
    runId: doc.run_id,
    eventId: doc.event_id,
    eventType: doc.event_type,
    entityLabel: doc.entity_label,
    companyId: Number.parseInt(doc.company_id, 10) || doc.company_id,
    pipeline: doc.pipeline || [],
    executionMode: doc.execution_mode || 'sequential',
    planReason: doc.plan_reason || '',
    steps: (doc.steps || []).map((step) => ({
      agentKey: step.agentKey,
      agentName: step.agentName,
      verdict: step.verdict,
      message: step.message || '',
      detail: step.detail || '',
      policyViolated: step.policyViolated || null,
      suggestedAction: step.suggestedAction || null,
      responseExcerpt: step.responseExcerpt,
      toolsUsed: (step.toolsUsed || []).map((tool) => ({
        name: tool.name,
        input: tool.input || {},
        success: tool.success !== false,
        durationMs: tool.durationMs || 0,
      })),
      durationMs: step.durationMs || 0,
      tokens: step.tokens || 0,
    })),
    status: doc.status || 'error',
    totalDurationMs: doc.total_duration_ms || 0,
    totalTokens: doc.total_tokens || 0,
    timestamp: (doc.timestamp || doc.created_at || new Date()).toISOString(),
  };
}

function alertToApi(doc, extras = {}) {
  return {
    alertId: doc.alert_id,
    severity: doc.severity,
    message: doc.message,
    detail: doc.detail,
    triggeredBy: doc.triggered_by,
    relatedEntity: doc.related_entity,
    customerType: extras.customerType || doc.customer_type || '',
    eventType: doc.event_type,
    policyViolated: doc.policy_violated,
    suggestedAction: doc.suggested_action,
    agentResponseExcerpt: doc.agent_response_excerpt,
    status: doc.status,
    timestamp: (doc.timestamp || doc.created_at || new Date()).toISOString(),
  };
}

async function customerTypeByRunId(companyId, rows) {
  const runIds = [...new Set(
    rows
      .filter((row) => !row.customer_type && row.run_id)
      .map((row) => String(row.run_id)),
  )];
  if (runIds.length === 0) return new Map();
  const runs = await PipelineRun.find({
    company_id: String(companyId),
    run_id: { $in: runIds },
  }).select('run_id payload').lean();
  const mapped = new Map();
  for (const run of runs) {
    const label = customerTypeFromPayload(run.payload);
    if (label) mapped.set(String(run.run_id), label);
  }
  return mapped;
}

function activeRunQuery(filter) {
  return {
    $and: [
      filter,
      { $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
    ],
  };
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
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

function deliveryIdFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.deliveryId ?? row.delivery_id ?? row.id ?? '').trim();
}

function laravelDeliveriesList(result) {
  if (!result || result.success === false) {
    return {
      ok: false,
      error: result?.error || 'WorxStream deliveries could not be retrieved.',
      items: [],
      pagination: null,
    };
  }

  let envelope = result.data;
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope) && envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) && Array.isArray(envelope.data.data)) {
    envelope = envelope.data;
  }

  const items = Array.isArray(envelope)
    ? envelope
    : Array.isArray(envelope?.data)
      ? envelope.data
      : Array.isArray(envelope?.items)
        ? envelope.items
        : [];
  const pagination = (!Array.isArray(envelope) && envelope?.pagination) || null;
  return { ok: true, items, pagination };
}

function listPaginationFromLaravel(pagination, page, perPage, visibleCount) {
  if (pagination && typeof pagination === 'object') {
    return {
      currentPage: Number(pagination.currentPage ?? page) || page,
      lastPage: Number(pagination.lastPage ?? 1) || 1,
      perPage: Number(pagination.perPage ?? pagination.limit ?? perPage) || perPage,
      total: Number(pagination.total ?? 0) || 0,
    };
  }
  return clampListPage(page, perPage, visibleCount).pagination;
}

async function deletedDeliveryIdsFor(companyId, ids) {
  if (ids.length === 0) return new Set();
  const rows = await WebhookDelivery.find({
    company_id: companyId,
    delivery_id: { $in: ids },
    deleted_at: { $ne: null },
  }).select('delivery_id').lean();
  return new Set(rows.map((row) => String(row.delivery_id)));
}

async function migrateHiddenDeliveryFlags(companyId) {
  const hidden = await HiddenWebhookDelivery.find({ company_id: companyId }).select('delivery_id deleted_at').lean();
  if (hidden.length === 0) return;
  await WebhookDelivery.bulkWrite(
    hidden.map((row) => ({
      updateOne: {
        filter: { company_id: companyId, delivery_id: String(row.delivery_id) },
        update: { $set: { deleted_at: row.deleted_at || new Date() } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await HiddenWebhookDelivery.deleteMany({ company_id: companyId });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Agents & pipelines (read-only) ───────────────────────────────────

router.get('/agents', (_req, res) => {
  const agents = Object.entries(GOVERNANCE_AGENT_DEFINITIONS).map(([key, def]) => ({
    key,
    name: getGovernanceAgentName(key),
    description: def.description,
  }));
  res.json({ success: true, data: agents });
});

router.get('/pipelines', (_req, res) => {
  res.json({ success: true, data: listPipelines() });
});

// ── Policies ─────────────────────────────────────────────────────────

router.get('/policies', async (req, res, next) => {
  try {
    const filter = { company_id: req.companyId };
    const { page, perPage } = parseListPage(req);
    const total = await GovernancePolicy.countDocuments(filter);
    const sliced = clampListPage(page, perPage, total);
    const rows = await GovernancePolicy.find(filter)
      .sort({ updated_at: -1 })
      .skip(sliced.skip)
      .limit(perPage);
    res.json({ success: true, data: rows.map(policyToApi), pagination: sliced.pagination });
  } catch (error) {
    next(error);
  }
});

router.post('/policies', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!name || !content) {
      return res.status(400).json({ success: false, error: 'name and content are required' });
    }
    const type = req.body?.type === 'rule' ? 'rule' : 'policy';
    const status = req.body?.status === 'draft' ? 'draft' : 'active';
    const doc = await GovernancePolicy.create({
      company_id: req.companyId,
      name,
      type,
      status,
      content,
    });
    await syncGovernanceDocumentChunks({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'policy',
      name,
      content,
      enabled: status === 'active',
    });
    res.status(201).json({ success: true, data: policyToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.put('/policies/:id', async (req, res, next) => {
  try {
    const doc = await GovernancePolicy.findOne({ _id: req.params.id, company_id: req.companyId });
    if (!doc) return res.status(404).json({ success: false, error: 'Policy not found' });

    if (req.body?.name != null) doc.name = String(req.body.name).trim();
    if (req.body?.content != null) doc.content = String(req.body.content).trim();
    if (req.body?.type === 'policy' || req.body?.type === 'rule') doc.type = req.body.type;
    if (req.body?.status === 'active' || req.body?.status === 'draft') doc.status = req.body.status;
    if (!doc.name || !doc.content) {
      return res.status(400).json({ success: false, error: 'name and content are required' });
    }
    await doc.save();
    await syncGovernanceDocumentChunks({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'policy',
      name: doc.name,
      content: doc.content,
      enabled: doc.status === 'active',
    });
    res.json({ success: true, data: policyToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.delete('/policies/:id', async (req, res, next) => {
  try {
    const doc = await GovernancePolicy.findOneAndDelete({ _id: req.params.id, company_id: req.companyId });
    if (!doc) return res.status(404).json({ success: false, error: 'Policy not found' });
    await removeDocumentChunks(req.companyId, String(doc._id));
    res.json({ success: true, data: { id: String(doc._id) } });
  } catch (error) {
    next(error);
  }
});

// ── Rules ────────────────────────────────────────────────────────────

router.get('/rules', async (req, res, next) => {
  try {
    const filter = { company_id: req.companyId };
    const { page, perPage } = parseListPage(req);
    const total = await GovernanceRule.countDocuments(filter);
    const sliced = clampListPage(page, perPage, total);
    const rows = await GovernanceRule.find(filter)
      .sort({ priority: 1, updated_at: -1 })
      .skip(sliced.skip)
      .limit(perPage);
    res.json({ success: true, data: rows.map(ruleToApi), pagination: sliced.pagination });
  } catch (error) {
    next(error);
  }
});

function ruleFieldsFromBody(body, partial = false) {
  const out = {};
  if (!partial || body.name != null) out.name = String(body.name || '').trim();
  if (
    !partial
    || body.eventTypes != null
    || body.event_types != null
    || body.eventType != null
    || body.event_type != null
  ) {
    const eventTypes = parseRuleEventTypes(body);
    out.event_types = eventTypes;
    out.event_type = eventTypes[0] || '';
  }
  if (!partial || body.condition != null) out.condition = String(body.condition || '').trim();
  if (!partial || body.action != null) out.action = String(body.action || '').trim();
  if (!partial || body.priority != null) {
    const priority = Number(body.priority);
    out.priority = Number.isFinite(priority) ? Math.min(5, Math.max(1, Math.round(priority))) : 2;
  }
  if (!partial || body.active != null) out.active = Boolean(body.active);
  return out;
}

router.post('/rules', async (req, res, next) => {
  try {
    const fields = ruleFieldsFromBody(req.body || {}, false);
    if (!fields.name || !fields.condition || !fields.action || !fields.event_type) {
      return res.status(400).json({ success: false, error: 'name, eventType(s), condition, and action are required' });
    }
    const doc = await GovernanceRule.create({
      company_id: req.companyId,
      ...fields,
    });
    const content = ruleChunkContent(doc);
    await syncGovernanceDocumentChunks({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'rule',
      name: doc.name,
      content,
      enabled: Boolean(doc.active),
    });
    res.status(201).json({ success: true, data: ruleToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.put('/rules/:id', async (req, res, next) => {
  try {
    const doc = await GovernanceRule.findOne({ _id: req.params.id, company_id: req.companyId });
    if (!doc) return res.status(404).json({ success: false, error: 'Rule not found' });
    const fields = ruleFieldsFromBody(req.body || {}, true);
    Object.assign(doc, fields);
    if (!doc.name || !doc.condition || !doc.action || !doc.event_type) {
      return res.status(400).json({ success: false, error: 'name, eventType(s), condition, and action are required' });
    }
    await doc.save();
    const content = ruleChunkContent(doc);
    await syncGovernanceDocumentChunks({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'rule',
      name: doc.name,
      content,
      enabled: Boolean(doc.active),
    });
    res.json({ success: true, data: ruleToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    const doc = await GovernanceRule.findOneAndDelete({ _id: req.params.id, company_id: req.companyId });
    if (!doc) return res.status(404).json({ success: false, error: 'Rule not found' });
    await removeDocumentChunks(req.companyId, String(doc._id));
    res.json({ success: true, data: { id: String(doc._id) } });
  } catch (error) {
    next(error);
  }
});

// ── Pipeline runs ────────────────────────────────────────────────────

router.get('/runs', async (req, res, next) => {
  try {
    const filter = activeRunQuery({ company_id: req.companyId });
    if (req.query.event_type && req.query.event_type !== 'all') {
      filter.$and[0].event_type = String(req.query.event_type);
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.$and[0].status = String(req.query.status);
    }
    const { page, perPage } = parseListPage(req);
    const total = await PipelineRun.countDocuments(filter);
    const sliced = clampListPage(page, perPage, total);
    const rows = await PipelineRun.find(filter)
      .sort({ timestamp: -1 })
      .skip(sliced.skip)
      .limit(perPage);
    res.json({
      success: true,
      data: rows.map(runToApi),
      pagination: sliced.pagination,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/runs/:runId', async (req, res, next) => {
  try {
    const doc = await PipelineRun.findOne(activeRunQuery({ company_id: req.companyId, run_id: req.params.runId }));
    if (!doc) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true, data: runToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/stop', async (req, res, next) => {
  try {
    const doc = await stopPipelineRun(req.companyId, req.params.runId);
    res.json({ success: true, data: runToApi(doc) });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/restart', async (req, res, next) => {
  try {
    const existing = await PipelineRun.findOne(activeRunQuery({ company_id: req.companyId, run_id: req.params.runId }));
    if (!existing) return res.status(404).json({ success: false, error: 'Run not found' });
    const userId = req.body?.user_id ?? req.query.user_id ?? req.query.userId;
    const result = await restartPipelineRun(req.companyId, req.params.runId, { userId });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/delete', async (req, res, next) => {
  try {
    const runIds = parseIdList(req.body?.run_ids ?? req.body?.runIds);
    if (runIds.length === 0) {
      return res.status(400).json({ success: false, error: 'run_ids is required' });
    }
    const result = await PipelineRun.updateMany(
      activeRunQuery({ company_id: req.companyId, run_id: { $in: runIds } }),
      { $set: { deleted_at: new Date() } },
    );
    res.json({ success: true, data: { deleted: result.modifiedCount || 0 } });
  } catch (error) {
    next(error);
  }
});

router.get('/deliveries', async (req, res, next) => {
  try {
    await migrateHiddenDeliveryFlags(req.companyId);
    const userId = userIdFromReq(req);
    if (!userId) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const { page, perPage } = parseListPage(req);
    const eventCode = req.query.event_code ? String(req.query.event_code).trim() : '';
    const status = req.query.status && req.query.status !== 'all'
      ? String(req.query.status).trim()
      : '';

    const result = await callWorxstreamAPI({
      method: 'GET',
      endpoint: '/company/webhooks/deliveries/list',
      data: {
        company_id: req.companyId,
        user_id: userId,
        page,
        per_page: perPage,
        ...(eventCode ? { event_code: eventCode } : {}),
        ...(status ? { status } : {}),
      },
    });

    const parsed = laravelDeliveriesList(result);
    if (!parsed.ok) {
      return res.status(502).json({ success: false, error: parsed.error });
    }

    const ids = parsed.items.map(deliveryIdFromRow).filter(Boolean);
    const deleted = await deletedDeliveryIdsFor(req.companyId, ids);
    const visible = parsed.items.filter((row) => !deleted.has(deliveryIdFromRow(row)));

    res.json({
      success: true,
      data: visible,
      pagination: listPaginationFromLaravel(parsed.pagination, page, perPage, visible.length),
      source: 'worxstream',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/deliveries/deleted-among', async (req, res, next) => {
  try {
    await migrateHiddenDeliveryFlags(req.companyId);
    const deliveryIds = parseIdList(req.body?.delivery_ids ?? req.body?.deliveryIds);
    const deleted = await deletedDeliveryIdsFor(req.companyId, deliveryIds);
    res.json({ success: true, data: [...deleted] });
  } catch (error) {
    next(error);
  }
});

router.post('/deliveries/delete', async (req, res, next) => {
  try {
    await migrateHiddenDeliveryFlags(req.companyId);
    const deliveryIds = parseIdList(req.body?.delivery_ids ?? req.body?.deliveryIds);
    if (deliveryIds.length === 0) {
      return res.status(400).json({ success: false, error: 'delivery_ids is required' });
    }
    const deletedAt = new Date();
    const result = await WebhookDelivery.bulkWrite(
      deliveryIds.map((deliveryId) => ({
        updateOne: {
          filter: { company_id: req.companyId, delivery_id: deliveryId },
          update: { $set: { deleted_at: deletedAt } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    const deleted = (result.modifiedCount || 0) + (result.upsertedCount || 0);
    res.json({ success: true, data: { deleted } });
  } catch (error) {
    next(error);
  }
});

// ── Alerts ───────────────────────────────────────────────────────────

router.get('/alerts', async (req, res, next) => {
  try {
    const filter = { company_id: req.companyId };
    if (req.query.severity && req.query.severity !== 'all') {
      filter.severity = String(req.query.severity);
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.status = String(req.query.status);
    }
    const { page, perPage } = parseListPage(req);
    const total = await GovernanceAlert.countDocuments(filter);
    const sliced = clampListPage(page, perPage, total);
    const rows = await GovernanceAlert.find(filter)
      .sort({ timestamp: -1 })
      .skip(sliced.skip)
      .limit(perPage);
    const typeByRun = await customerTypeByRunId(req.companyId, rows);
    res.json({
      success: true,
      data: rows.map((row) => alertToApi(row, {
        customerType: row.customer_type || typeByRun.get(String(row.run_id)) || '',
      })),
      pagination: sliced.pagination,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/alerts/resolve', async (req, res, next) => {
  try {
    const alertIds = parseIdList(req.body?.alert_ids ?? req.body?.alertIds);
    if (alertIds.length === 0) {
      return res.status(400).json({ success: false, error: 'alert_ids is required' });
    }
    const result = await GovernanceAlert.updateMany(
      {
        company_id: req.companyId,
        alert_id: { $in: alertIds },
        status: 'open',
      },
      { $set: { status: 'resolved' } },
    );
    res.json({ success: true, data: { resolved: result.modifiedCount || 0 } });
  } catch (error) {
    next(error);
  }
});

router.patch('/alerts/:alertId', async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (status !== 'open' && status !== 'resolved') {
      return res.status(400).json({ success: false, error: 'status must be open or resolved' });
    }
    const doc = await GovernanceAlert.findOneAndUpdate(
      { company_id: req.companyId, alert_id: req.params.alertId },
      { $set: { status } },
      { new: true },
    );
    if (!doc) return res.status(404).json({ success: false, error: 'Alert not found' });
    let customerType = doc.customer_type || '';
    if (!customerType && doc.run_id) {
      const typeByRun = await customerTypeByRunId(req.companyId, [doc]);
      customerType = typeByRun.get(String(doc.run_id)) || '';
    }
    res.json({ success: true, data: alertToApi(doc, { customerType }) });
  } catch (error) {
    next(error);
  }
});

// ── Dashboard ────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const today = startOfToday();
    const weekAgo = daysAgoDate(7);

    const [todayRuns, weekRuns, openAlerts, agentKeys] = await Promise.all([
      PipelineRun.find(activeRunQuery({
        company_id: companyId,
        timestamp: { $gte: today },
        status: { $ne: 'running' },
      })).lean(),
      PipelineRun.find(activeRunQuery({
        company_id: companyId,
        timestamp: { $gte: weekAgo },
        status: { $ne: 'running' },
      }))
        .sort({ timestamp: -1 })
        .lean(),
      GovernanceAlert.countDocuments({ company_id: companyId, status: 'open' }),
      Promise.resolve(Object.keys(GOVERNANCE_AGENT_DEFINITIONS)),
    ]);

    const weekPassed = weekRuns.filter((r) => r.status === 'pass').length;
    const passRate = weekRuns.length === 0 ? 0 : Math.round((weekPassed / weekRuns.length) * 100);

    const kpi = {
      runsToday: todayRuns.length,
      passRate,
      openAlerts,
      activePipelines: countActivePipelines(),
    };

    const agentStats = agentKeys.map((key) => {
      const todaySteps = [];
      let lastRunAt = null;
      for (const run of weekRuns) {
        const step = (run.steps || []).find((s) => s.agentKey === key);
        if (!step) continue;
        const ts = run.timestamp ? new Date(run.timestamp).toISOString() : null;
        if (ts && (!lastRunAt || ts > lastRunAt)) lastRunAt = ts;
        const runDay = run.timestamp ? new Date(run.timestamp) : null;
        if (runDay && runDay >= today) todaySteps.push(step);
      }
      const weekSteps = weekRuns.flatMap((run) => (run.steps || []).filter((s) => s.agentKey === key));
      const weekPass = weekSteps.filter((s) => s.verdict === 'pass').length;
      const avgDuration = weekSteps.length === 0
        ? 0
        : Math.round(weekSteps.reduce((sum, s) => sum + (s.durationMs || 0), 0) / weekSteps.length);

      return {
        key,
        name: getGovernanceAgentName(key),
        description: GOVERNANCE_AGENT_DEFINITIONS[key].description,
        status: 'healthy',
        runsToday: todaySteps.length,
        avgDurationMs: avgDuration,
        lastRunAt: lastRunAt || null,
        passRate: weekSteps.length === 0 ? 0 : Math.round((weekPass / weekSteps.length) * 100),
      };
    });

    const distMap = new Map();
    for (const run of weekRuns) {
      distMap.set(run.event_type, (distMap.get(run.event_type) || 0) + 1);
    }
    const distTotal = weekRuns.length || 1;
    const eventDistribution = [...distMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([eventType, count]) => ({
        eventType,
        count,
        pct: Math.round((count / distTotal) * 100),
      }));

    const recentRuns = weekRuns.slice(0, 10).map(runToApi);

    res.json({
      success: true,
      data: { kpi, agentStats, eventDistribution, recentRuns },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
