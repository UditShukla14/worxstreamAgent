/**
 * Vigil — review stored alerts against the current policy/rule catalog.
 *
 * Stale alerts (draft/inactive/invented checks) are permanently deleted.
 * Open alerts that still match the catalog are re-evaluated with Aegis
 * against the live entity; a pass (or omitted finding) marks them resolved.
 */

import GovernanceAlert from '../models/GovernanceAlert.js';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import PipelineRun from '../models/PipelineRun.js';
import { eventTypesFromRule, ruleAppliesToEvent } from './ruleEvents.js';
import { evaluateGovernanceEvent } from './pipelineRunner.js';

const runningCompanies = new Set();
const FLUSH_EVERY = 20;
export const LEGACY_RESOLVE_REASON = 'Resolved before a reason was required.';

export function isAlertSweepRunning(companyId) {
  return runningCompanies.has(String(companyId));
}

function normalizeCheckName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function checksMatch(a, b) {
  const left = normalizeCheckName(a);
  const right = normalizeCheckName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function alertLabels(alert) {
  return [
    alert?.policy_violated ?? alert?.policyViolated,
    alert?.triggered_by ?? alert?.triggeredBy,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function labelsMatchName(labels, name) {
  return labels.some((label) => checksMatch(label, name));
}

export function decideAlertAction(alert, catalog) {
  const labels = alertLabels(alert);
  const eventType = alert?.event_type ?? alert?.eventType ?? '';
  const policies = Array.isArray(catalog?.policies) ? catalog.policies : [];
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : [];

  const activePolicies = policies.filter((row) => String(row.status || '').toLowerCase() === 'active');
  if (activePolicies.some((row) => labelsMatchName(labels, row.name))) {
    return 'review';
  }

  const activeRules = rules.filter((row) => row.active !== false);
  const matchingActiveRules = activeRules.filter((row) => labelsMatchName(labels, row.name));
  if (matchingActiveRules.some((row) => ruleAppliesToEvent({
    ...row,
    event_type: row.event_type ?? row.eventType,
    event_types: eventTypesFromRule(row),
  }, eventType))) {
    return 'review';
  }

  return 'delete';
}

/**
 * Map an Aegis re-check onto one stored alert.
 * Fail closed (keep) when the evaluation did not return structured findings.
 * Resolve when the check now passes or Aegis no longer reports it.
 *
 * @returns {{ action: 'keep' | 'resolve', reason: string }}
 */
export function actionFromReview(alert, findings, { evaluationOk = true } = {}) {
  if (!evaluationOk) return { action: 'keep', reason: '' };
  const labels = alertLabels(alert);
  const match = (findings || []).find((row) => (
    labels.some((label) => (
      checksMatch(label, row.check) || checksMatch(label, row.policyViolated)
    ))
  ));
  if (!match) {
    return {
      action: 'resolve',
      reason: 'Vigil: this check is no longer reported for the live record against the current catalog.',
    };
  }
  if (match.verdict === 'pass') {
    const check = String(match.check || 'this policy/rule').trim();
    const detail = String(match.detail || '').trim();
    return {
      action: 'resolve',
      reason: detail
        ? `Vigil: ${check} now passes. ${detail}`
        : `Vigil: ${check} now passes on the live record.`,
    };
  }
  return { action: 'keep', reason: '' };
}

export function alertNeedsResolveReason(alert) {
  if (String(alert?.status || '') !== 'resolved') return false;
  const reason = String(alert?.resolve_reason ?? alert?.resolveReason ?? '').trim();
  return !reason || reason === LEGACY_RESOLVE_REASON;
}

export function reasonForResolvedReview(decision, { evaluationOk = true } = {}) {
  if (decision?.action === 'resolve' && String(decision.reason || '').trim()) {
    return String(decision.reason).trim().slice(0, 2000);
  }
  if (!evaluationOk) return 'Previously resolved; live re-check could not be completed.';
  return 'Previously resolved; live check still flags this policy/rule.';
}

function missingResolveReasonFilter(companyId) {
  return {
    company_id: String(companyId),
    status: 'resolved',
    $or: [
      { resolve_reason: { $exists: false } },
      { resolve_reason: null },
      { resolve_reason: '' },
    ],
  };
}

export async function backfillMissingResolveReasons(companyId) {
  const result = await GovernanceAlert.updateMany(
    missingResolveReasonFilter(companyId),
    { $set: { resolve_reason: LEGACY_RESOLVE_REASON } },
  );
  return result.modifiedCount || 0;
}

function normalizeResolveEntries(entries, fallbackReason = '') {
  const reasonFallback = String(fallbackReason || '').trim().slice(0, 2000);
  if (!Array.isArray(entries)) return [];
  const mapped = [];
  for (const entry of entries) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const alertId = String(entry).trim();
      if (alertId) mapped.push({ alertId, reason: reasonFallback });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const alertId = String(entry.alertId ?? entry.alert_id ?? '').trim();
    if (!alertId) continue;
    mapped.push({
      alertId,
      reason: String(entry.reason || reasonFallback).trim().slice(0, 2000),
    });
  }
  return mapped;
}

export async function resolveAlertsById(companyId, alertIds, { reason = '', resolvedBy = 'operator' } = {}) {
  const rows = normalizeResolveEntries(alertIds, reason).filter((row) => row.reason);
  if (rows.length === 0) return 0;
  const now = new Date();
  const result = await GovernanceAlert.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: {
          company_id: String(companyId),
          alert_id: row.alertId,
          status: 'open',
        },
        update: {
          $set: {
            status: 'resolved',
            resolve_reason: row.reason,
            resolved_at: now,
            resolved_by: resolvedBy,
          },
        },
      },
    })),
    { ordered: false },
  );
  return result.modifiedCount || 0;
}

export async function writeAlertResolveReasons(companyId, entries, { resolvedBy = 'vigil' } = {}) {
  const rows = normalizeResolveEntries(entries).filter((row) => row.reason);
  if (rows.length === 0) return 0;
  const actor = String(resolvedBy || 'vigil').trim() || 'vigil';
  const result = await GovernanceAlert.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: {
          company_id: String(companyId),
          alert_id: row.alertId,
          status: 'resolved',
        },
        update: [
          {
            $set: {
              resolve_reason: row.reason,
              resolved_by: {
                $cond: [
                  { $eq: [{ $ifNull: ['$resolved_by', ''] }, ''] },
                  actor,
                  '$resolved_by',
                ],
              },
            },
          },
        ],
      },
    })),
    { ordered: false },
  );
  return result.modifiedCount || 0;
}

export async function loadSweepCatalog(companyId) {
  const [policies, rules] = await Promise.all([
    GovernancePolicy.find({ company_id: String(companyId) }).select('name status').lean(),
    GovernanceRule.find({ company_id: String(companyId) }).select('name active event_type event_types').lean(),
  ]);
  return {
    policies: (policies || []).map((row) => ({
      name: row.name,
      status: row.status,
    })),
    rules: (rules || []).map((row) => ({
      name: row.name,
      active: Boolean(row.active),
      event_type: row.event_type,
      event_types: eventTypesFromRule(row),
      eventTypes: eventTypesFromRule(row),
    })),
  };
}

export async function deleteAlertsPermanently(companyId, alertIds) {
  const ids = [...new Set((alertIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const result = await GovernanceAlert.deleteMany({
    company_id: String(companyId),
    alert_id: { $in: ids },
  });
  return result.deletedCount || 0;
}

function emptyProgress(total = 0) {
  return {
    type: 'progress',
    processed: 0,
    total,
    deleted: 0,
    resolved: 0,
    kept: 0,
  };
}

function yieldLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function groupByRunId(alerts) {
  const grouped = new Map();
  for (const alert of alerts) {
    const runId = String(alert.run_id || '').trim();
    const key = runId || `__none_${alert.alert_id}`;
    const list = grouped.get(key) || [];
    list.push(alert);
    grouped.set(key, list);
  }
  return grouped;
}

/**
 * @param {{
 *   companyId: string,
 *   onStart?: () => void,
 *   onProgress?: (event: object) => void,
 * }} options
 */
export async function runAlertSweep({ companyId, onStart, onProgress }) {
  const tenant = String(companyId);
  if (runningCompanies.has(tenant)) {
    const error = new Error('A Vigil review is already running for this company.');
    error.status = 409;
    throw error;
  }

  runningCompanies.add(tenant);
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  if (typeof onStart === 'function') onStart();

  try {
    const catalog = await loadSweepCatalog(tenant);
    const alerts = await GovernanceAlert.find({ company_id: tenant })
      .select('alert_id status event_type policy_violated triggered_by run_id resolve_reason')
      .sort({ timestamp: -1 })
      .lean();

    const totals = emptyProgress(alerts.length);
    emit({ ...totals });

    const pendingDelete = [];
    const pendingResolve = [];
    const pendingReasons = [];

    async function flush() {
      if (pendingDelete.length > 0) {
        totals.deleted += await deleteAlertsPermanently(tenant, pendingDelete.splice(0, pendingDelete.length));
      }
      if (pendingResolve.length > 0) {
        totals.resolved += await resolveAlertsById(tenant, pendingResolve.splice(0, pendingResolve.length), {
          resolvedBy: 'vigil',
        });
      }
      if (pendingReasons.length > 0) {
        await writeAlertResolveReasons(tenant, pendingReasons.splice(0, pendingReasons.length), {
          resolvedBy: 'vigil',
        });
      }
    }

    const toReview = [];
    for (const alert of alerts) {
      if (decideAlertAction(alert, catalog) === 'delete') {
        pendingDelete.push(alert.alert_id);
        totals.processed += 1;
        if (totals.processed % FLUSH_EVERY === 0) {
          await flush();
          emit({ ...totals, type: 'progress' });
          await yieldLoop();
        }
      } else {
        toReview.push(alert);
      }
    }

    const alreadyResolvedDone = toReview.filter((alert) => (
      alert.status !== 'open' && !alertNeedsResolveReason(alert)
    ));
    totals.kept += alreadyResolvedDone.length;
    totals.processed += alreadyResolvedDone.length;
    await flush();
    emit({ ...totals, type: 'progress' });

    const reviewGroup = toReview.filter((alert) => (
      alert.status === 'open' || alertNeedsResolveReason(alert)
    ));
    const byRun = groupByRunId(reviewGroup);

    for (const [runKey, group] of byRun) {
      const runId = runKey.startsWith('__none_') ? '' : runKey;
      let evaluation = { ok: false, findings: [] };

      if (runId) {
        const run = await PipelineRun.findOne({
          company_id: tenant,
          run_id: runId,
        }).select('payload event_type').lean();
        const payload = run?.payload && typeof run.payload === 'object' ? run.payload : null;
        if (payload) {
          evaluation = await evaluateGovernanceEvent({
            companyId: tenant,
            eventType: run.event_type || group[0].event_type,
            payload,
            preferLiveEntity: true,
          });
        }
      }

      for (const alert of group) {
        const decision = actionFromReview(alert, evaluation.findings, { evaluationOk: evaluation.ok });
        if (alert.status === 'open') {
          if (decision.action === 'resolve') {
            pendingResolve.push({ alertId: alert.alert_id, reason: decision.reason });
          } else {
            totals.kept += 1;
          }
        } else {
          pendingReasons.push({
            alertId: alert.alert_id,
            reason: reasonForResolvedReview(decision, { evaluationOk: evaluation.ok }),
          });
          totals.kept += 1;
        }
        totals.processed += 1;
      }

      await flush();
      emit({ ...totals, type: 'progress' });
      await yieldLoop();
    }

    await flush();
    const done = { ...totals, type: 'done' };
    emit(done);
    console.log(`🛡️  Vigil sweep ${tenant}: processed ${done.processed}, deleted ${done.deleted}, resolved ${done.resolved}, kept ${done.kept}`);
    return done;
  } catch (error) {
    emit({
      ...emptyProgress(),
      type: 'error',
      message: error.message || String(error),
    });
    throw error;
  } finally {
    runningCompanies.delete(tenant);
  }
}
