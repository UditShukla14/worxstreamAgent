/**
 * Run Aegis against one Worxstream webhook event.
 *
 * Hydrate a shared entity snapshot, then Aegis evaluates every active
 * policy/rule. Findings are persisted as pipeline steps so Control Tower
 * can show each check.
 */

import { randomUUID } from 'crypto';
import PipelineRun from '../models/PipelineRun.js';
import GovernanceAlert from '../models/GovernanceAlert.js';
import { getPipelineForEvent } from './pipelineConfig.js';
import { getGovernanceAgent } from './governanceRegistry.js';
import { AEGIS_AGENT_KEY, getGovernanceAgentName } from './governanceAgents.js';
import { retrieveAllGovernanceChunks } from './rag.js';
import {
  buildMasterMessage,
  customerTypeFromPayload,
  entityLabelFromPayload,
  loadPolicyCatalog,
} from './contextBuilder.js';
import { parseGovernanceFindings, runStatusFromSteps } from './parseVerdict.js';
import { hydrateSharedContext } from './hydrateSharedContext.js';
import { getDefaultTenantIds } from '../config/index.js';
import { runWithRequestContext } from '../request/requestContext.js';

/** Cooperative cancel: stop is honored between master-agent steps, not mid-LLM call. */
const cancelRequested = new Set();
const persistQueues = new Map();

export function requestPipelineStop(runId) {
  cancelRequested.add(String(runId));
}

function clearPipelineStop(runId) {
  cancelRequested.delete(String(runId));
}

function stopRequested(runId) {
  return cancelRequested.has(String(runId));
}

function enqueuePersist(runId, task) {
  const key = String(runId);
  const prev = persistQueues.get(key) || Promise.resolve();
  const next = prev.then(task, task);
  persistQueues.set(key, next.catch((error) => {
    console.error('❌ Pipeline persist error:', error);
  }));
  return next;
}

export function startPipelineInBackground(event) {
  const companyId = String(event.company_id);
  const userId = event.user_id != null ? String(event.user_id) : getDefaultTenantIds().userId;
  const apiToken = process.env.WORXSTREAM_API_TOKEN || '';

  setImmediate(() => {
    runWithRequestContext({ companyId, userId, apiToken }, async () => {
      try {
        await runPipeline(event);
      } catch (error) {
        console.error('❌ Governance pipeline error:', error);
      }
    });
  });
}

function flattenToolInput(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

function mapToolsUsed(toolsUsed) {
  if (!Array.isArray(toolsUsed)) return [];
  return toolsUsed.map((tool) => ({
    name: tool.name || 'unknown',
    input: flattenToolInput(tool.input),
    success: tool.success !== false,
    durationMs: Number.isFinite(tool.durationMs) ? tool.durationMs : 0,
  }));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function pendingStep(agentKey) {
  return {
    agentKey,
    agentName: getGovernanceAgentName(agentKey),
    verdict: 'running',
    responseExcerpt: 'In progress…',
    toolsUsed: [],
    durationMs: 0,
    tokens: 0,
    message: 'Running',
    detail: '',
    policyViolated: null,
    suggestedAction: null,
    relatedEntity: '',
    severity: null,
  };
}

async function replaceAllSteps(runId, steps) {
  return enqueuePersist(runId, async () => {
    const doc = await PipelineRun.findOne({ run_id: String(runId) });
    if (!doc) return null;
    doc.steps = steps;
    doc.total_tokens = steps.reduce((sum, row) => sum + (row.tokens || 0), 0);
    await doc.save();
    return doc;
  });
}

async function markRemainingSkipped(runId, reason) {
  return enqueuePersist(runId, async () => {
    const doc = await PipelineRun.findOne({ run_id: String(runId) });
    if (!doc) return null;
    doc.steps = (doc.steps || []).map((row) => {
      if (row.verdict !== 'running') return row;
      const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
      return {
        ...plain,
        verdict: 'skipped',
        responseExcerpt: reason,
        message: 'Skipped',
        detail: reason,
      };
    });
    await doc.save();
    return doc;
  });
}

async function createStepAlert({ companyId, runId, eventId, eventType, entityLabel, customerType, step }) {
  if (step.verdict === 'pass' || step.verdict === 'running' || step.verdict === 'skipped') return null;
  const alertId = `alr_${randomUUID()}`;
  await GovernanceAlert.create({
    company_id: companyId,
    alert_id: alertId,
    run_id: runId,
    event_id: eventId,
    severity: step.severity || (step.verdict === 'error' ? 'info' : 'warning'),
    message: step.message || step.responseExcerpt,
    detail: step.detail || step.responseExcerpt,
    triggered_by: step.agentName,
    related_entity: step.relatedEntity || entityLabel,
    customer_type: customerType || '',
    event_type: eventType,
    policy_violated: step.policyViolated || (step.verdict === 'error' ? 'N/A — System Error' : ''),
    suggested_action: step.suggestedAction || '',
    agent_response_excerpt: step.responseExcerpt,
    status: 'open',
    timestamp: new Date(),
  });
  return alertId;
}

export async function stopPipelineRun(companyId, runId) {
  const doc = await PipelineRun.findOne({
    company_id: String(companyId),
    run_id: String(runId),
  });
  if (!doc) throw httpError(404, 'Run not found');
  if (doc.status !== 'running') {
    throw httpError(409, 'Only a running pipeline can be stopped');
  }
  requestPipelineStop(doc.run_id);
  doc.status = 'stopped';
  await doc.save();
  console.log(`🛡️  Pipeline ${doc.run_id} stop requested`);
  return doc;
}

export async function restartPipelineRun(companyId, runId, { userId } = {}) {
  const doc = await PipelineRun.findOne({
    company_id: String(companyId),
    run_id: String(runId),
  });
  if (!doc) throw httpError(404, 'Run not found');
  if (doc.status === 'running') {
    throw httpError(409, 'Stop the running pipeline before restarting');
  }

  const event = {
    event_type: doc.event_type,
    event_id: doc.event_id,
    timestamp: new Date().toISOString(),
    company_id: doc.company_id,
    user_id: userId != null ? String(userId) : doc.user_id,
    payload: doc.payload && typeof doc.payload === 'object' ? doc.payload : {},
  };

  startPipelineInBackground(event);
  console.log(`🛡️  Pipeline ${doc.run_id} restart queued for ${doc.event_type}`);
  return { previousRunId: doc.run_id, eventId: doc.event_id, eventType: doc.event_type };
}

function asStep({
  agentKey,
  agentName,
  verdict,
  responseExcerpt,
  toolsUsed = [],
  durationMs = 0,
  tokens = 0,
  message,
  detail,
  policyViolated = null,
  suggestedAction = null,
  relatedEntity,
  severity = null,
}) {
  return {
    agentKey,
    agentName,
    verdict,
    responseExcerpt,
    toolsUsed,
    durationMs,
    tokens,
    message,
    detail,
    policyViolated,
    suggestedAction,
    relatedEntity,
    severity,
  };
}

async function runAegisChecks({
  eventType,
  payload,
  companyId,
  entityLabel,
  runId,
  snapshot,
}) {
  const agentName = getGovernanceAgentName(AEGIS_AGENT_KEY);
  const stepStart = Date.now();
  const agent = getGovernanceAgent(AEGIS_AGENT_KEY);

  if (stopRequested(runId)) {
    return [asStep({
      agentKey: AEGIS_AGENT_KEY,
      agentName,
      verdict: 'skipped',
      responseExcerpt: 'Stopped before Aegis started.',
      message: 'Skipped',
      detail: 'Pipeline stop was requested.',
      relatedEntity: entityLabel,
    })];
  }

  if (!agent) {
    return [asStep({
      agentKey: AEGIS_AGENT_KEY,
      agentName,
      verdict: 'error',
      responseExcerpt: 'Aegis is not initialized.',
      durationMs: Date.now() - stepStart,
      message: 'Missing Aegis agent',
      detail: 'The pipeline runner has no Aegis instance.',
      suggestedAction: 'Restart the agent server so governance agents initialize.',
      relatedEntity: entityLabel,
      severity: 'info',
    })];
  }

  try {
    const [ragChunks, catalog] = await Promise.all([
      retrieveAllGovernanceChunks(companyId, { maxChunks: 40 }),
      loadPolicyCatalog(companyId),
    ]);
    const message = buildMasterMessage({
      eventType,
      payload,
      companyId,
      ragChunks,
      agentKey: AEGIS_AGENT_KEY,
      snapshot,
      catalog,
    });

    const result = await agent.run(message, {
      fromAgent: 'control-tower',
      reason: `governance pipeline ${eventType}`,
      skipClarification: true,
    });

    const durationMs = Date.now() - stepStart;
    const tokens = result.usage?.total_tokens || 0;
    const toolsUsed = mapToolsUsed(result.toolsUsed);

    if (stopRequested(runId)) {
      return [asStep({
        agentKey: AEGIS_AGENT_KEY,
        agentName,
        verdict: 'skipped',
        responseExcerpt: 'Stopped while Aegis was running.',
        toolsUsed,
        durationMs,
        tokens,
        message: 'Skipped',
        detail: 'Pipeline stop was requested.',
        relatedEntity: entityLabel,
      })];
    }

    const findings = parseGovernanceFindings(result.response, {
      message: 'Aegis check',
      relatedEntity: entityLabel,
    });

    return findings.map((finding, index) => asStep({
      agentKey: finding.agentKey,
      agentName: finding.check || agentName,
      verdict: finding.verdict,
      responseExcerpt: finding.responseExcerpt || finding.detail,
      toolsUsed: index === 0 ? toolsUsed : [],
      durationMs: index === 0 ? durationMs : 0,
      tokens: index === 0 ? tokens : 0,
      message: finding.message,
      detail: finding.detail,
      policyViolated: finding.policyViolated,
      suggestedAction: finding.suggestedAction,
      relatedEntity: finding.relatedEntity || entityLabel,
      severity: finding.severity,
    }));
  } catch (error) {
    console.error('❌ [Aegis] pipeline failed:', error);
    return [asStep({
      agentKey: AEGIS_AGENT_KEY,
      agentName,
      verdict: 'error',
      responseExcerpt: error.message || String(error),
      durationMs: Date.now() - stepStart,
      message: 'Aegis failed',
      detail: error.message || String(error),
      suggestedAction: 'Inspect agent logs and re-deliver the webhook if the entity exists.',
      relatedEntity: entityLabel,
      severity: 'info',
    })];
  }
}

/**
 * @param {{
 *   event_type: string,
 *   event_id?: string,
 *   company_id: string|number,
 *   user_id?: string|number,
 *   payload?: object,
 *   timestamp?: string,
 * }} event
 */
export async function runPipeline(event) {
  const eventType = String(event.event_type || '').trim();
  const companyId = String(event.company_id);
  const eventId = String(event.event_id || `evt_${randomUUID()}`);
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const pipeline = getPipelineForEvent(eventType);
  const entityLabel = entityLabelFromPayload(payload, eventType);
  const runId = `run_${randomUUID()}`;
  const startedAt = Date.now();

  if (pipeline.length === 0) {
    console.log(`🛡️  No governance pipeline for event_type="${eventType}" — skipping`);
    return {
      skipped: true,
      reason: 'no_pipeline',
      event_type: eventType,
      event_id: eventId,
    };
  }

  const runDoc = await PipelineRun.create({
    company_id: companyId,
    run_id: runId,
    event_id: eventId,
    event_type: eventType,
    entity_label: entityLabel,
    user_id: event.user_id != null ? String(event.user_id) : '',
    payload,
    pipeline,
    execution_mode: pipeline.length === 1 ? 'single' : 'parallel',
    plan_reason: 'Loading shared entity context…',
    steps: pipeline.map(pendingStep),
    status: 'running',
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
  });

  console.log(`🛡️  Pipeline ${runId} hydrating shared context for ${eventType}`);
  const hydrated = await hydrateSharedContext({ eventType, payload });
  const workingPayload = hydrated.payload;
  const snapshot = hydrated.snapshot;
  const workingLabel = entityLabelFromPayload(workingPayload, eventType);
  const customerType = customerTypeFromPayload(workingPayload);
  runDoc.payload = workingPayload;
  runDoc.entity_label = workingLabel;
  runDoc.execution_mode = 'single';
  runDoc.plan_reason = 'Aegis evaluates all active policies and rules';
  runDoc.pipeline = [AEGIS_AGENT_KEY];
  runDoc.steps = [pendingStep(AEGIS_AGENT_KEY)];
  await runDoc.save();
  if (snapshot.notes.length > 0) {
    console.log(`🛡️  Shared context notes: ${snapshot.notes.join(' | ')}`);
  }
  if (snapshot.errors.length > 0) {
    console.warn(`🛡️  Shared context gaps: ${snapshot.errors.join(' | ')}`);
  }

  console.log(`\n🛡️  Pipeline ${runId} Aegis for ${eventType}`);

  const findingSteps = await runAegisChecks({
    eventType,
    payload: workingPayload,
    companyId,
    entityLabel: workingLabel,
    runId,
    snapshot,
  });
  await replaceAllSteps(runId, findingSteps);

  const alerts = [];
  for (const step of findingSteps) {
    const alertId = await createStepAlert({
      companyId,
      runId,
      eventId,
      eventType,
      entityLabel: workingLabel,
      customerType,
      step,
    });
    if (alertId) alerts.push(alertId);
  }

  if (stopRequested(runId)) {
    await markRemainingSkipped(runId, 'Pipeline stop was requested.');
  }

  const totalDurationMs = Date.now() - startedAt;
  const wasStopped = stopRequested(runId);
  clearPipelineStop(runId);
  await (persistQueues.get(runId) || Promise.resolve());
  persistQueues.delete(runId);

  const fresh = await PipelineRun.findOne({ run_id: runId });
  const target = fresh || runDoc;
  const steps = target.steps || [];
  target.total_duration_ms = totalDurationMs;
  target.total_tokens = steps.reduce((sum, step) => sum + (step.tokens || 0), 0);
  if (wasStopped || target.status === 'stopped') {
    target.status = 'stopped';
  } else {
    target.status = runStatusFromSteps(steps);
  }
  await target.save();
  const status = target.status;

  console.log(`🛡️  Pipeline ${runId} ${status} (${steps.length} checks, ${alerts.length} alerts, ${totalDurationMs}ms)`);

  return {
    skipped: false,
    runId,
    eventId,
    eventType,
    status,
    mode: 'single',
    steps: steps.length,
    alerts,
    totalDurationMs,
  };
}
