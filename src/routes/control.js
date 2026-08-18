/**
 * Control Tower APIs — policies, rules, pipeline runs, alerts, dashboard.
 * All routes are scoped by company_id (query or body).
 */

import { Router } from 'express';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import PipelineRun from '../models/PipelineRun.js';
import GovernanceAlert from '../models/GovernanceAlert.js';
import {
  GOVERNANCE_AGENT_DEFINITIONS,
  getGovernanceAgentName,
  listPipelines,
  countActivePipelines,
  reindexDocument,
  removeDocumentChunks,
  acceptGovernanceEvent,
  eventFromWorxstreamDelivery,
  stopPipelineRun,
  restartPipelineRun,
} from '../control/index.js';

const router = Router();

const RULE_EVENT_TYPES = new Set([
  'estimate.created',
  'estimate.updated',
  'invoice.created',
  'invoice.updated',
  'invoice.paid',
  'customer.created',
  'customer.updated',
  'product.updated',
  'job.created',
  'credit_memo.created',
]);

function companyIdFromReq(req) {
  const raw = req.query.company_id
    ?? req.query.companyId
    ?? req.body?.company_id
    ?? req.body?.companyId;
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
  return {
    id: String(doc._id),
    name: doc.name,
    eventType: doc.event_type,
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

function alertToApi(doc) {
  return {
    alertId: doc.alert_id,
    severity: doc.severity,
    message: doc.message,
    detail: doc.detail,
    triggeredBy: doc.triggered_by,
    relatedEntity: doc.related_entity,
    eventType: doc.event_type,
    policyViolated: doc.policy_violated,
    suggestedAction: doc.suggested_action,
    agentResponseExcerpt: doc.agent_response_excerpt,
    status: doc.status,
    timestamp: (doc.timestamp || doc.created_at || new Date()).toISOString(),
  };
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

/**
 * Control Tower forwards Worxstream deliveries here because the cloud
 * backend cannot POST to a local agent. No webhook secret — company_id
 * from the session/body is the tenant gate.
 */
router.post('/ingest-delivery', async (req, res, next) => {
  try {
    const delivery = req.body?.delivery && typeof req.body.delivery === 'object'
      ? req.body.delivery
      : (req.body || {});

    const deliveryCompany = delivery.companyId ?? delivery.company_id;
    const deliveryCompanyId = deliveryCompany != null ? String(deliveryCompany).trim() : '';
    if (deliveryCompanyId && deliveryCompanyId !== '0' && deliveryCompanyId !== String(req.companyId)) {
      return res.status(403).json({ success: false, error: 'delivery company_id does not match' });
    }

    const userId = req.body?.user_id ?? req.query.user_id ?? req.query.userId;
    const event = eventFromWorxstreamDelivery(delivery, {
      companyId: req.companyId,
      userId,
    });

    if (!event.event_type) {
      return res.status(400).json({ success: false, error: 'Could not determine event_type from delivery' });
    }
    if (!event.event_id) {
      return res.status(400).json({ success: false, error: 'deliveryId is required' });
    }

    console.log(
      `🛡️  Ingest delivery ${delivery.deliveryId || delivery.delivery_id || event.event_id} → ${event.event_type}`,
    );

    const result = await acceptGovernanceEvent(event);
    res.json({
      success: true,
      delivery_id: String(delivery.deliveryId || delivery.delivery_id || ''),
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

// ── Policies ─────────────────────────────────────────────────────────

router.get('/policies', async (req, res, next) => {
  try {
    const rows = await GovernancePolicy.find({ company_id: req.companyId }).sort({ updated_at: -1 });
    res.json({ success: true, data: rows.map(policyToApi) });
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
    await reindexDocument({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'policy',
      name,
      content,
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
    await reindexDocument({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'policy',
      name: doc.name,
      content: doc.content,
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
    const rows = await GovernanceRule.find({ company_id: req.companyId }).sort({ priority: 1, updated_at: -1 });
    res.json({ success: true, data: rows.map(ruleToApi) });
  } catch (error) {
    next(error);
  }
});

function ruleFieldsFromBody(body, partial = false) {
  const out = {};
  if (!partial || body.name != null) out.name = String(body.name || '').trim();
  if (!partial || body.eventType != null || body.event_type != null) {
    out.event_type = String(body.eventType || body.event_type || '').trim();
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
      return res.status(400).json({ success: false, error: 'name, eventType, condition, and action are required' });
    }
    if (!RULE_EVENT_TYPES.has(fields.event_type)) {
      return res.status(400).json({ success: false, error: `Unsupported eventType: ${fields.event_type}` });
    }
    const doc = await GovernanceRule.create({
      company_id: req.companyId,
      ...fields,
    });
    const content = `${doc.name}\nEvent: ${doc.event_type}\nWhen: ${doc.condition}\nThen: ${doc.action}`;
    await reindexDocument({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'rule',
      name: doc.name,
      content,
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
    if (fields.event_type && !RULE_EVENT_TYPES.has(fields.event_type)) {
      return res.status(400).json({ success: false, error: `Unsupported eventType: ${fields.event_type}` });
    }
    Object.assign(doc, fields);
    if (!doc.name || !doc.condition || !doc.action || !doc.event_type) {
      return res.status(400).json({ success: false, error: 'name, eventType, condition, and action are required' });
    }
    await doc.save();
    const content = `${doc.name}\nEvent: ${doc.event_type}\nWhen: ${doc.condition}\nThen: ${doc.action}`;
    await reindexDocument({
      companyId: req.companyId,
      documentId: String(doc._id),
      documentType: 'rule',
      name: doc.name,
      content,
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
    const filter = { company_id: req.companyId };
    if (req.query.event_type && req.query.event_type !== 'all') {
      filter.event_type = String(req.query.event_type);
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.status = String(req.query.status);
    }
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const rows = await PipelineRun.find(filter).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, data: rows.map(runToApi) });
  } catch (error) {
    next(error);
  }
});

router.get('/runs/:runId', async (req, res, next) => {
  try {
    const doc = await PipelineRun.findOne({ company_id: req.companyId, run_id: req.params.runId });
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
    const userId = req.body?.user_id ?? req.query.user_id ?? req.query.userId;
    const result = await restartPipelineRun(req.companyId, req.params.runId, { userId });
    res.json({ success: true, data: result });
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
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const rows = await GovernanceAlert.find(filter).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, data: rows.map(alertToApi) });
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
    res.json({ success: true, data: alertToApi(doc) });
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
      PipelineRun.find({ company_id: companyId, timestamp: { $gte: today }, status: { $ne: 'running' } }).lean(),
      PipelineRun.find({ company_id: companyId, timestamp: { $gte: weekAgo }, status: { $ne: 'running' } })
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
