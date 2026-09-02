/**
 * Deterministic report generation — lists estimates/invoices in a period and
 * evaluates configured criteria (missing fields, negative profit).
 */

import { callWorxstreamAPI } from '../services/httpClient.js';
import { getWorxstreamContext } from '../config/index.js';
import { runWithRequestContext } from '../request/requestContext.js';
import ReportRun from '../models/ReportRun.js';
import {
  buildRowSnapshot,
  evaluateReportCriteria,
  readField,
} from './reportCriteria.js';

const MAX_PAGES = 20;
const PAGE_LIMIT = 50;
const DETAIL_CONCURRENCY = 6;

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
  const peeled = peel(result.data ?? result);
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

async function listEntitiesInPeriod(entityType, periodStart, periodEnd) {
  const { companyId, userId } = getWorxstreamContext();
  const { from, to } = periodDates(periodStart, periodEnd);
  const appName = entityType;
  const rows = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await callWorxstreamAPI({
      method: 'POST',
      endpoint: '/master-objects/list',
      data: {
        companyId,
        userId,
        appName,
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
    if (!result?.success) break;
    const pageRows = apiRows(result);
    rows.push(...pageRows);
    const pagination = peel(result.data)?.pagination;
    const lastPage = pagination?.lastPage;
    if (Number.isFinite(lastPage) && page >= lastPage) break;
    if (pageRows.length < PAGE_LIMIT) break;
  }

  return rows;
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
  if (!result?.success) return null;
  const peeled = peel(result.data ?? result);
  return peeled && typeof peeled === 'object' && !Array.isArray(peeled) ? peeled : null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichForCriteria(listRow, entityType, criteriaType) {
  if (criteriaType !== 'missing_fields') return listRow;
  const id = asEntityId(listRow);
  if (id == null) return listRow;
  const detail = await fetchEntityDetail(entityType, id);
  return detail ? { ...listRow, ...detail } : listRow;
}

function asEntityId(record) {
  const id = readField(record, 'id');
  return id != null ? Number(id) : null;
}

/**
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {{ periodStart: Date, periodEnd: Date, trigger?: 'scheduled' | 'manual' }} options
 */
export async function generateReportRun(definition, options) {
  const { periodStart, periodEnd } = options;
  const entityTypes = Array.isArray(definition.entity_types) && definition.entity_types.length > 0
    ? definition.entity_types
    : ['estimate', 'invoice'];

  const run = await ReportRun.create({
    company_id: definition.company_id,
    definition_id: definition._id,
    definition_name: definition.name,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'running',
    generated_at: new Date(),
  });

  try {
    const matchedRows = [];
    let scanned = 0;

    for (const entityType of entityTypes) {
      const listRows = await listEntitiesInPeriod(entityType, periodStart, periodEnd);
      scanned += listRows.length;

      const enriched = await mapWithConcurrency(
        listRows,
        DETAIL_CONCURRENCY,
        (row) => enrichForCriteria(row, entityType, definition.criteria_type),
      );

      for (const record of enriched) {
        const entityId = asEntityId(record);
        if (entityId == null) continue;
        const match = evaluateReportCriteria(
          record,
          definition.criteria_type,
          definition.criteria_fields || [],
        );
        if (!match) continue;
        matchedRows.push({
          entity_type: entityType,
          entity_id: entityId,
          label: entityLabel(entityType, record),
          customer_name: customerName(record),
          reason: match.reason,
          snapshot: buildRowSnapshot(record, definition.criteria_type, definition.criteria_fields || []),
        });
      }
    }

    const summary = {
      scanned,
      matched: matchedRows.length,
      estimates: matchedRows.filter((row) => row.entity_type === 'estimate').length,
      invoices: matchedRows.filter((row) => row.entity_type === 'invoice').length,
    };

    run.status = 'completed';
    run.summary = summary;
    run.rows = matchedRows;
    await run.save();
    return run;
  } catch (error) {
    run.status = 'error';
    run.error_message = error instanceof Error ? error.message : String(error);
    await run.save();
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

export async function runWithDefinitionContext(definition, fn) {
  const apiToken = (process.env.WORXSTREAM_API_TOKEN || '').trim();
  if (!apiToken) {
    throw new Error('WORXSTREAM_API_TOKEN is not configured for scheduled reports.');
  }
  return runWithRequestContext({
    companyId: String(definition.company_id),
    userId: String(definition.user_id),
    apiToken,
  }, fn);
}

/**
 * @param {import('../models/ReportDefinition.js').default} definition
 * @param {{ trigger?: 'scheduled' | 'manual', apiToken?: string, userId?: string }} [options]
 */
export async function executeReportDefinition(definition, options = {}) {
  const period = computeReportPeriod(definition);
  const runFn = () => generateReportRun(definition, {
    ...period,
    trigger: options.trigger || 'scheduled',
  });

  const apiToken = options.apiToken || (process.env.WORXSTREAM_API_TOKEN || '').trim();
  if (!apiToken) {
    throw new Error('WorxStream API token is not available for this report run.');
  }

  const userId = options.userId || definition.user_id;

  return runWithRequestContext({
    companyId: String(definition.company_id),
    userId: String(userId),
    apiToken,
  }, runFn).then(async (run) => {
    definition.last_run_at = new Date();
    definition.next_run_at = computeNextRunAt(definition, new Date());
    await definition.save();
    return run;
  });
}
