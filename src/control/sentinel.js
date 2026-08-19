/**
 * Sentinel — Aegis's child agent.
 *
 * Periodic (and policy-change) sweep over existing Aegis runs. When the live
 * WorxStream document or the active catalog has changed, Sentinel re-invokes
 * Aegis and updates that run + its alerts in place so Control Tower does not
 * show stale verdicts. Chat router never sees this key. Webhooks still run
 * Aegis only.
 */

import PipelineRun from '../models/PipelineRun.js';
import GovernanceAlert from '../models/GovernanceAlert.js';
import { config } from '../config/index.js';
import { runWithRequestContext } from '../request/requestContext.js';
import { hydrateSharedContext } from './hydrateSharedContext.js';
import {
  catalogFingerprint,
  entityKeyFromRun,
  payloadFingerprint,
} from './governanceFingerprint.js';
import {
  customerTypeFromPayload,
  entityLabelFromPayload,
} from './contextBuilder.js';
import { runStatusFromSteps } from './parseVerdict.js';
import {
  createStepAlert,
  evaluateAegisChecks,
} from './pipelineRunner.js';
import {
  SENTINEL_AGENT_KEY,
  getGovernanceAgentName,
} from './governanceAgents.js';

let timer = null;
let sweeping = false;
const pendingCompanies = new Set();
const debounceTimers = new Map();

function activeRunFilter(extra = {}) {
  return {
    $and: [
      extra,
      { $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
    ],
  };
}

function normalizeCheckKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findingMatchKey(step) {
  return normalizeCheckKey(step.policyViolated || step.agentName || step.message);
}

function alertMatchKey(alert) {
  return normalizeCheckKey(alert.policy_violated || alert.triggered_by || alert.message);
}

function sentinelStep({ entityLabel, reason, durationMs = 0, tokens = 0 }) {
  return {
    agentKey: SENTINEL_AGENT_KEY,
    agentName: getGovernanceAgentName(SENTINEL_AGENT_KEY),
    verdict: 'pass',
    responseExcerpt: reason,
    toolsUsed: [],
    durationMs,
    tokens,
    message: 'Re-evaluated live document',
    detail: reason,
    policyViolated: null,
    suggestedAction: null,
    relatedEntity: entityLabel,
    severity: null,
  };
}

async function syncAlertsForRun({
  companyId,
  runId,
  eventId,
  eventType,
  entityLabel,
  customerType,
  steps,
}) {
  const alerts = await GovernanceAlert.find({
    company_id: String(companyId),
    run_id: String(runId),
  });
  const openByKey = new Map();
  const anyByKey = new Map();
  for (const alert of alerts) {
    const key = alertMatchKey(alert);
    if (!key) continue;
    anyByKey.set(key, alert);
    if (alert.status === 'open') openByKey.set(key, alert);
  }

  const usedKeys = new Set();
  for (const step of steps) {
    if (step.agentKey === SENTINEL_AGENT_KEY) continue;
    if (step.verdict !== 'flag' && step.verdict !== 'error') continue;
    const key = findingMatchKey(step);
    if (!key) continue;
    usedKeys.add(key);

    const open = openByKey.get(key);
    if (open) {
      open.severity = step.severity || open.severity;
      open.message = step.message || open.message;
      open.detail = step.detail || open.detail;
      open.triggered_by = step.agentName || open.triggered_by;
      open.related_entity = step.relatedEntity || entityLabel || open.related_entity;
      open.customer_type = customerType || open.customer_type;
      open.policy_violated = step.policyViolated || open.policy_violated;
      open.suggested_action = step.suggestedAction || open.suggested_action;
      open.agent_response_excerpt = step.responseExcerpt || open.agent_response_excerpt;
      await open.save();
      continue;
    }

    const existing = anyByKey.get(key);
    if (existing && existing.status === 'resolved' && existing.resolved_by === 'user') {
      continue;
    }

    await createStepAlert({
      companyId,
      runId,
      eventId,
      eventType,
      entityLabel,
      customerType,
      step,
    });
  }

  for (const [key, alert] of openByKey) {
    if (usedKeys.has(key)) continue;
    alert.status = 'resolved';
    alert.resolved_by = 'sentinel';
    await alert.save();
  }
}

async function latestRunsByEntity(companyId, since) {
  const rows = await PipelineRun.find(activeRunFilter({
    company_id: String(companyId),
    timestamp: { $gte: since },
    status: { $nin: ['running', 'stopped'] },
  }))
    .sort({ timestamp: -1 })
    .lean();

  const seen = new Set();
  const latest = [];
  for (const row of rows) {
    const key = entityKeyFromRun(row.event_type, row.payload) || `run:${row.run_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest;
}

async function reconcileRun(run, catalogHash) {
  const companyId = String(run.company_id);
  const storedPayload = run.payload && typeof run.payload === 'object' ? run.payload : {};
  const hydrated = await hydrateSharedContext({
    eventType: run.event_type,
    payload: storedPayload,
    refreshEntity: true,
  });
  const livePayload = hydrated.payload;
  const snapshot = hydrated.snapshot;
  if (!snapshot.enrichment?.from_api && (snapshot.errors || []).length > 0) {
    return { skipped: true, reason: 'refresh_failed' };
  }

  const payloadChanged = run.payload_fingerprint !== nextPayloadHash;
  const catalogChanged = run.catalog_fingerprint !== catalogHash;
  if (run.payload_fingerprint && run.catalog_fingerprint && !payloadChanged && !catalogChanged) {
    return { skipped: true, reason: 'unchanged' };
  }

  const reasons = [];
  if (payloadChanged) {
    reasons.push(run.payload_fingerprint ? 'document changed' : 'live document refresh');
  }
  if (catalogChanged) {
    reasons.push(run.catalog_fingerprint ? 'policy catalog changed' : 'policy catalog refresh');
  }
  if (reasons.length === 0) reasons.push('live document refresh');
  const reason = `Sentinel re-evaluated: ${reasons.join(' and ')}`;

  const entityLabel = entityLabelFromPayload(livePayload, run.event_type) || run.entity_label;
  const customerType = customerTypeFromPayload(livePayload);
  const startedAt = Date.now();
  const findingSteps = await evaluateAegisChecks({
    eventType: run.event_type,
    payload: livePayload,
    companyId,
    entityLabel,
    runId: run.run_id,
    snapshot,
  });
  const durationMs = Date.now() - startedAt;
  const tokens = findingSteps.reduce((sum, step) => sum + (step.tokens || 0), 0);
  const steps = [
    ...findingSteps,
    sentinelStep({ entityLabel, reason, durationMs, tokens }),
  ];
  const status = runStatusFromSteps(findingSteps);

  await PipelineRun.updateOne(
    { company_id: companyId, run_id: run.run_id },
    {
      $set: {
        payload: livePayload,
        entity_label: entityLabel,
        steps,
        status,
        plan_reason: reason,
        total_duration_ms: durationMs,
        total_tokens: tokens,
        payload_fingerprint: nextPayloadHash,
        catalog_fingerprint: catalogHash,
        last_reconciled_at: new Date(),
        reconcile_reason: reason,
      },
    },
  );

  await syncAlertsForRun({
    companyId,
    runId: run.run_id,
    eventId: run.event_id,
    eventType: run.event_type,
    entityLabel,
    customerType,
    steps: findingSteps,
  });

  console.log(`🛰️  Sentinel updated ${run.run_id} → ${status} (${reason})`);
  return { skipped: false, status, reason };
}

async function sweepCompany(companyId) {
  const lookbackMs = config.sentinel.lookbackDays * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - lookbackMs);
  const catalogHash = await catalogFingerprint(companyId);
  const candidates = await latestRunsByEntity(companyId, since);
  let evaluated = 0;

  for (const run of candidates) {
    if (evaluated >= config.sentinel.maxPerTick) break;
    const userId = run.user_id || '';
    const result = await runWithRequestContext(
      { companyId, userId, apiToken: process.env.WORXSTREAM_API_TOKEN || '' },
      () => reconcileRun(run, catalogHash),
    );
    if (!result?.skipped) evaluated += 1;
  }

  return { candidates: candidates.length, evaluated };
}

async function sweepAll(companyIds) {
  if (sweeping) {
    for (const id of companyIds) pendingCompanies.add(String(id));
    return;
  }
  sweeping = true;
  try {
    let ids = [...new Set(companyIds.map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) {
      const lookbackMs = config.sentinel.lookbackDays * 24 * 60 * 60 * 1000;
      const since = new Date(Date.now() - lookbackMs);
      ids = await PipelineRun.distinct('company_id', activeRunFilter({
        timestamp: { $gte: since },
        status: { $nin: ['running', 'stopped'] },
      }));
    }
    for (const companyId of ids) {
      try {
        const result = await sweepCompany(companyId);
        if (result.evaluated > 0) {
          console.log(`🛰️  Sentinel ${companyId}: re-evaluated ${result.evaluated}/${result.candidates} documents`);
        }
      } catch (error) {
        console.error(`🛰️  Sentinel sweep failed for company ${companyId}:`, error);
      }
    }
  } finally {
    sweeping = false;
    if (pendingCompanies.size > 0) {
      const queued = [...pendingCompanies];
      pendingCompanies.clear();
      setImmediate(() => {
        sweepAll(queued).catch((error) => console.error('🛰️  Sentinel queued sweep failed:', error));
      });
    }
  }
}

export function scheduleSentinelSweep(companyId) {
  if (!config.sentinel.enabled) return;
  const id = String(companyId || '').trim();
  if (!id) return;
  const existing = debounceTimers.get(id);
  if (existing) clearTimeout(existing);
  const timerId = setTimeout(() => {
    debounceTimers.delete(id);
    sweepAll([id]).catch((error) => console.error('🛰️  Sentinel catalog sweep failed:', error));
  }, config.sentinel.debounceMs);
  debounceTimers.set(id, timerId);
}

function loop() {
  sweepAll([])
    .catch((error) => console.error('🛰️  Sentinel interval sweep failed:', error))
    .finally(() => {
      timer = setTimeout(loop, config.sentinel.intervalMs);
    });
}

export function startAegisSentinel() {
  if (!config.sentinel.enabled) {
    console.log('🛰️  Sentinel disabled (AEGIS_SENTINEL_ENABLED=false)');
    return;
  }
  if (timer) return;
  console.log(
    `🛰️  Sentinel watching Aegis outcomes every ${Math.round(config.sentinel.intervalMs / 1000)}s `
    + `(lookback ${config.sentinel.lookbackDays}d, max ${config.sentinel.maxPerTick}/company)`,
  );
  timer = setTimeout(loop, Math.min(config.sentinel.intervalMs, 30_000));
}
