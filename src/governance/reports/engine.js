/**
 * Deterministic report generation — list IDs in a period, load full records via show,
 * then evaluate configured criteria (missing fields, negative profit).
 */

import { callWorxstreamAPI } from '../services/httpClient.js';
import { getWorxstreamContext } from '../config/index.js';
import { runWithRequestContext } from '../request/requestContext.js';
import { requireEnvWorxstreamCredentials } from '../utils/worxstreamCredentials.js';
import ReportRun from '../models/ReportRun.js';
import {
  buildRowSnapshot,
  evaluateReportCriteria,
  readField,
} from './reportCriteria.js';

const MAX_PAGES = 10;
const PAGE_LIMIT = 50;
const MAX_IDS_PER_TYPE = MAX_PAGES * PAGE_LIMIT;

function detailRequestGapMs() {
  const raw = Number(process.env.REPORT_DETAIL_REQUEST_GAP_MS ?? '200');
  return Number.isFinite(raw) && raw >= 0 ? raw : 200;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Serialize mongoose saves — parallel progress updates must not call save() concurrently. */
const runSaveQueues = new WeakMap();

function enqueueRunMutation(run, mutate) {
  const previous = runSaveQueues.get(run) || Promise.resolve();
  const next = previous.then(async () => {
    await mutate();
  });
  runSaveQueues.set(run, next.catch(() => {}));
  return next;
}

function applyProgressStep(run, { key, label, status, detail, phase }) {
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

function apiRows(result) {
  if (!result || result.success === false) return [];
  const body = result.data ?? result;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  const peeled = peel(body);
  if (Array.isArray(peeled)) return peeled;
  if (Array.isArray(peeled?.data)) return peeled.data;
  return [];
}

function entityLabel(entityType, record) {
  const custom = readField(record, 'customNumber') ?? readField(record, 'custom_number');
  const id = readField(record, 'id');
  const prefix = entityType === 'invoice' ? 'Invoice' : 'Estimate';
  if (custom) return `${prefix} #${custom}`;
  if (id != null) return `${prefix} #${id}`;
  return prefix;
}

function customerName(record) {
  const customer = record.customer;
  if (customer && typeof customer === 'object') {
    return String(customer.customerName ?? customer.name ?? customer.title ?? '').trim();
  }
  return String(readField(record, 'customerName') ?? readField(record, 'customer_name') ?? '').trim();
}

function periodDates(periodStart, periodEnd) {
  const from = periodStart.toISOString().slice(0, 10);
  const to = periodEnd.toISOString().slice(0, 10);
  return { from, to };
}

function criteriaFieldsFor(definition) {
  if (definition.criteria_type !== 'missing_fields') return [];
  return definition.criteria_fields?.length
    ? definition.criteria_fields
    : ['trackingNo', 'trackingUrl', 'trackingCompany'];
}

function extractEntityIds(listRows) {
  const ids = [];
  const seen = new Set();
  for (const row of listRows) {
    const id = asEntityId(row);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function buildInitialProgress(definition, period) {
  const entityTypes = Array.isArray(definition.entity_types) && definition.entity_types.length > 0
    ? definition.entity_types
    : ['estimate', 'invoice'];
  const { from, to } = periodDates(period.periodStart, period.periodEnd);
  const criteria = definition.criteria_type === 'missing_fields'
    ? `missing ${criteriaFieldsFor(definition).join(', ')}`
    : 'negative gross profit';

  const steps = [
    {
      key: 'init',
      label: 'Initialize Scribe run',
      status: 'running',
      detail: `${definition.name} · ${from} to ${to} · ${criteria}`,
      at: new Date(),
    },
    {
      key: 'auth',
      label: 'Connect to WorxStream API',
      status: 'pending',
      detail: '',
      at: new Date(),
    },
  ];

  for (const entityType of entityTypes) {
    steps.push({
      key: `list-${entityType}`,
      label: `List ${entityType} IDs`,
      status: 'pending',
      detail: `POST /master-objects/list (IDs only) · created_at BETWEEN ${from} and ${to}`,
      at: new Date(),
    });
    steps.push({
      key: `detail-${entityType}`,
      label: `Load ${entityType} details`,
      status: 'pending',
      detail: `One GET /master-objects/show at a time for ${entityType}s (gap between calls)`,
      at: new Date(),
    });
    steps.push({
      key: `evaluate-${entityType}`,
      label: `Evaluate ${entityType}s`,
      status: 'pending',
      detail: `Criteria checked after each ${entityType} show response`,
      at: new Date(),
    });
  }

  steps.push({
    key: 'finalize',
    label: 'Finalize report',
    status: 'pending',
    detail: '',
    at: new Date(),
  });

  return { phase: 'starting', steps };
}

async function listEntitiesInPeriod(entityType, periodStart, periodEnd, onPage) {
  const { companyId, userId } = getWorxstreamContext();
  const { from, to } = periodDates(periodStart, periodEnd);
  const rows = [];
  const apiErrors = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await callWorxstreamAPI({
      method: 'POST',
      endpoint: '/master-objects/list',
      data: {
        companyId,
        userId,
        appName: entityType,
        page,
        limit: PAGE_LIMIT,
        filter: {
          advance: [{
            db_attribute: 'created_at',
            operator: 'BETWEEN',
            value: [from, to],
          }],
        },
      },
    });

    if (!result?.success) {
      const message = result?.error || 'WorxStream list request failed';
      apiErrors.push({ page, error: message });
      onPage?.({ page, rows: 0, total: rows.length, error: message });
      break;
    }

    const pageRows = apiRows(result);
    rows.push(...pageRows);
    const pagination = peel(result.data)?.pagination ?? result.data?.pagination;
    const lastPage = pagination?.lastPage;
    onPage?.({
      page,
      rows: pageRows.length,
      total: rows.length,
      lastPage: Number.isFinite(lastPage) ? lastPage : undefined,
    });

    if (Number.isFinite(lastPage) && page >= lastPage) break;
    if (pageRows.length < PAGE_LIMIT) break;
  }

  return { rows, apiErrors };
}

async function loadAndEvaluateEntityType(entityType, entityIds, definition, onItemProgress) {
  const matchedRows = [];
  let errors = 0;
  const gapMs = detailRequestGapMs();
  const criteriaFields = criteriaFieldsFor(definition);

  for (let index = 0; index < entityIds.length; index += 1) {
    const entityId = entityIds[index];
    const { record, error } = await fetchEntityDetail(entityType, entityId);

    if (error || !record) {
      errors += 1;
    } else {
      const match = evaluateReportCriteria(record, definition.criteria_type, criteriaFields);
      if (match) {
        matchedRows.push({
          entity_type: entityType,
          entity_id: entityId,
          label: entityLabel(entityType, record),
          customer_name: customerName(record),
          reason: match.reason,
          snapshot: buildRowSnapshot(record, definition.criteria_type, criteriaFields),
        });
      }
    }

    await onItemProgress?.({
      loaded: index + 1,
      total: entityIds.length,
      entityId,
      errors,
      matched: matchedRows.length,
      gapMs,
    });

    if (index < entityIds.length - 1 && gapMs > 0) {
      await sleep(gapMs);
    }
  }

  return { matchedRows, errors };
}

async function fetchEntityDetail(entityType, entityId) {
  const { companyId, userId } = getWorxstreamContext();
  const result = await callWorxstreamAPI({
    method: 'GET',
    endpoint: '/master-objects/show',
    data: {
      company_id: companyId,
      user_id: userId,
      appName: entityType,
      id: entityId,
    },
  });
  if (!result?.success) return { record: null, error: result?.error || 'Detail request failed' };
  const peeled = peel(result.data ?? result);
  const record = peeled && typeof peeled === 'object' && !Array.isArray(peeled) ? peeled : null;
  return { record, error: record ? null : 'Empty detail response' };
}

function asEntityId(record) {
  const id = readField(record, 'id');
  return id != null ? Number(id) : null;
}

/**
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {{ periodStart: Date, periodEnd: Date }} period
 * @param {{ companyId?: string, userId?: string, trigger?: 'manual' | 'scheduled' }} [meta]
 */
export async function createPendingReportRun(definition, period, meta = {}) {
  const companyId = String(meta.companyId || definition.company_id);
  const userId = String(meta.userId || definition.user_id || '');
  return ReportRun.create({
    company_id: companyId,
    user_id: userId,
    definition_id: definition._id,
    definition_name: definition.name,
    trigger: meta.trigger === 'scheduled' ? 'scheduled' : 'manual',
    period_start: period.periodStart,
    period_end: period.periodEnd,
    status: 'running',
    generated_at: new Date(),
    progress: buildInitialProgress(definition, period),
  });
}

/**
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {import('../models/ReportRun.js').default} run
 * @param {{ periodStart: Date, periodEnd: Date }} period
 */
export async function fillReportRun(definition, run, period) {
  const { periodStart, periodEnd } = period;
  const entityTypes = Array.isArray(definition.entity_types) && definition.entity_types.length > 0
    ? definition.entity_types
    : ['estimate', 'invoice'];

  const listFailures = [];

  try {
    await upsertProgressStep(run, {
      key: 'init',
      status: 'done',
      detail: `Document types processed separately: ${entityTypes.join(' → ')}`,
      phase: 'auth',
    });

    const { companyId, userId } = getWorxstreamContext();
    await upsertProgressStep(run, {
      key: 'auth',
      status: 'done',
      detail: `Using agent .env · company ${companyId}, user ${userId}`,
      phase: 'listing',
    });

    const matchedRows = [];
    let scanned = 0;

    for (const entityType of entityTypes) {
      const listKey = `list-${entityType}`;
      await upsertProgressStep(run, {
        key: listKey,
        status: 'running',
        phase: 'listing',
      });

      const { rows: listRows, apiErrors } = await listEntitiesInPeriod(
        entityType,
        periodStart,
        periodEnd,
        async ({ page, rows, total, lastPage, error }) => {
          if (error) {
            await upsertProgressStep(run, {
              key: listKey,
              status: 'running',
              detail: `Page ${page} failed: ${error}`,
            });
            return;
          }
          await upsertProgressStep(run, {
            key: listKey,
            status: 'running',
            detail: lastPage
              ? `Page ${page}/${lastPage} · ${total} ID(s) collected`
              : `Page ${page} · ${total} ID(s) collected (+${rows} this page)`,
          });
        },
      );

      const entityIds = extractEntityIds(listRows).slice(0, MAX_IDS_PER_TYPE);
      scanned += entityIds.length;

      if (apiErrors.length > 0) {
        const message = apiErrors.map((item) => `page ${item.page}: ${item.error}`).join('; ');
        listFailures.push(`${entityType}: ${message}`);
        await upsertProgressStep(run, {
          key: listKey,
          status: 'error',
          detail: message,
        });
      } else if (entityIds.length === 0) {
        await upsertProgressStep(run, {
          key: listKey,
          status: 'warn',
          detail: `No ${entityType}s returned for this period`,
        });
      } else {
        await upsertProgressStep(run, {
          key: listKey,
          status: 'done',
          detail: `Collected ${entityIds.length} ${entityType} ID(s) — list rows are not used for criteria`,
        });
      }

      const detailKey = `detail-${entityType}`;
      const evaluateKey = `evaluate-${entityType}`;
      let entityMatches = 0;
      let detailErrors = 0;

      if (entityIds.length > 0) {
        const gapMs = detailRequestGapMs();
        await upsertProgressStep(run, {
          key: detailKey,
          status: 'running',
          detail: `${entityType}: 0/${entityIds.length} · one show call at a time · ${gapMs}ms gap`,
          phase: 'enriching',
        });
        await upsertProgressStep(run, {
          key: evaluateKey,
          status: 'running',
          detail: `Waiting for ${entityType} show responses…`,
          phase: 'evaluating',
        });

        const { matchedRows: typeMatches, errors } = await loadAndEvaluateEntityType(
          entityType,
          entityIds,
          definition,
          async ({ loaded, total, entityId, errors: errCount, matched, gapMs: gap }) => {
            if (loaded === total || loaded === 1 || loaded % 5 === 0) {
              await upsertProgressStep(run, {
                key: detailKey,
                status: 'running',
                detail: `${entityType}: ${loaded}/${total} · id ${entityId} · ${gap}ms gap · ${matched} matched · ${errCount} error(s)`,
              });
            }
          },
        );

        detailErrors = errors;
        entityMatches = typeMatches.length;
        matchedRows.push(...typeMatches);

        await upsertProgressStep(run, {
          key: detailKey,
          status: detailErrors > 0 ? 'warn' : 'done',
          detail: `${entityType}: ${entityIds.length - detailErrors}/${entityIds.length} show OK · ${detailErrors} error(s)`,
        });
      } else {
        await upsertProgressStep(run, {
          key: detailKey,
          status: 'done',
          detail: `${entityType}: nothing to load`,
        });
      }

      await upsertProgressStep(run, {
        key: evaluateKey,
        status: 'done',
        detail: `${entityMatches} ${entityType}(s) matched criteria`,
      });
    }

    if (listFailures.length > 0 && scanned === 0) {
      run.status = 'error';
      run.error_message = `Could not load documents: ${listFailures.join(' · ')}`;
    } else {
      run.status = 'completed';
      run.error_message = listFailures.length > 0
        ? `Completed with list warnings: ${listFailures.join(' · ')}`
        : '';
    }

    run.summary = {
      scanned,
      matched: matchedRows.length,
      estimates: matchedRows.filter((row) => row.entity_type === 'estimate').length,
      invoices: matchedRows.filter((row) => row.entity_type === 'invoice').length,
    };
    run.rows = matchedRows;

    await upsertProgressStep(run, {
      key: 'finalize',
      status: run.status === 'error' ? 'error' : 'done',
      detail: run.status === 'error'
        ? run.error_message
        : `Scanned ${scanned}, matched ${matchedRows.length}`,
      phase: 'done',
    });

    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run.status = 'error';
    run.error_message = message;
    await upsertProgressStep(run, {
      key: 'finalize',
      status: 'error',
      detail: message,
      phase: 'done',
    });
    throw error;
  }
}

export function computeReportPeriod(definition, asOf = new Date()) {
  const end = new Date(asOf);
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, definition.interval_days || 1));
  start.setUTCHours(0, 0, 0, 0);
  return { periodStart: start, periodEnd: end };
}

export function computeNextRunAt(definition, fromDate = new Date()) {
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

async function withDefinitionCredentials(_definition, _options, fn) {
  const creds = requireEnvWorxstreamCredentials();
  return runWithRequestContext(creds, fn);
}

/**
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {{ trigger?: 'scheduled' | 'manual', apiToken?: string, userId?: string }} [options]
 */
export async function executeReportDefinition(definition, options = {}) {
  const period = computeReportPeriod(definition);
  const run = await createPendingReportRun(definition, period, {
    companyId: definition.company_id,
    userId: definition.user_id,
    trigger: options.trigger === 'scheduled' ? 'scheduled' : 'manual',
  });
  await withDefinitionCredentials(definition, options, () => fillReportRun(definition, run, period));
  definition.last_run_at = new Date();
  definition.next_run_at = computeNextRunAt(definition, new Date());
  await definition.save();
  return run;
}

/**
 * Start a report run in the background and return the pending run immediately.
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {{ apiToken?: string, userId?: string }} options
 */
export async function queueReportDefinition(definition, options = {}) {
  const period = computeReportPeriod(definition);
  const companyId = String(options.companyId || definition.company_id);
  if (String(definition.company_id) !== companyId) {
    throw new Error('Report schedule does not belong to this company.');
  }
  const run = await createPendingReportRun(definition, period, {
    companyId,
    userId: options.userId || definition.user_id,
    trigger: options.trigger === 'scheduled' ? 'scheduled' : 'manual',
  });

  setImmediate(() => {
    withDefinitionCredentials(definition, options, async () => {
      await fillReportRun(definition, run, period);
      definition.last_run_at = new Date();
      definition.next_run_at = computeNextRunAt(definition, new Date());
      await definition.save();
    }).catch(async (error) => {
      console.error(`❌ Report run failed (${definition.name}):`, error instanceof Error ? error.message : error);
      if (run.status === 'running') {
        run.status = 'error';
        run.error_message = error instanceof Error ? error.message : String(error);
        await upsertProgressStep(run, {
          key: 'finalize',
          status: 'error',
          detail: run.error_message,
          phase: 'done',
        }).catch(() => {});
      }
    });
  });

  return run;
}
