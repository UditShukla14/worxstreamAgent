/**
 * Attach supplementary context for Aegis governance checks.
 *
 * The WorxStream webhook payload is the source of truth for all entity fields
 * (amounts, margins, line items, customer, status). This module only:
 * 1. Resolves entity IDs when the payload is sparse
 * 2. Fetches enrichment the payload cannot carry (overdue invoices, product stock)
 *
 * When the payload is substantive, no entity/line-item fields are copied or remapped.
 */

import { callWorxstreamAPI } from '../services/httpClient.js';
import { getWorxstreamContext } from '../config/index.js';

const STOCK_FIELDS = [
  'quantity_on_hand',
  'qty_on_hand',
  'available_qty',
  'available_quantity',
  'stock_qty',
  'stock',
  'qty',
  'quantity',
];

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function peel(value) {
  let current = value;
  for (let i = 0; i < 5; i += 1) {
    if (!current || typeof current !== 'object') return current;
    if (Array.isArray(current)) return current;
    if (current.id != null || current.customer_id != null || current.estimate_id != null) {
      return current;
    }
    const inner = current.data ?? current.item ?? current.result;
    if (inner == null) return current;
    current = inner;
  }
  return current;
}

function apiRecord(result) {
  if (!result || result.success === false) return null;
  const peeled = peel(result.data ?? result);
  if (Array.isArray(peeled)) return peeled[0] || null;
  return peeled && typeof peeled === 'object' ? peeled : null;
}

function apiRows(result) {
  if (!result || result.success === false) return [];
  const peeled = peel(result.data ?? result);
  if (Array.isArray(peeled)) return peeled;
  if (Array.isArray(peeled?.data)) return peeled.data;
  if (Array.isArray(peeled?.items)) return peeled.items;
  return [];
}

export function extractEntityIds(payload = {}, eventType = '') {
  const p = payload && typeof payload === 'object' ? payload : {};
  const ids = {
    estimate_id: asNumber(p.estimate_id ?? p.estimateId),
    invoice_id: asNumber(p.invoice_id ?? p.invoiceId),
    customer_id: asNumber(
      p.customer_id
      ?? p.customerId
      ?? p.customer?.customerId
      ?? p.customer?.customer_id,
    ),
    product_id: asNumber(p.product_id ?? p.productId),
    job_id: asNumber(p.job_id ?? p.jobId),
    credit_memo_id: asNumber(p.credit_memo_id ?? p.creditMemoId),
  };
  const prefix = String(eventType || '').split('.')[0];
  if (ids[`${prefix}_id`] == null && asNumber(p.id) != null) {
    if (prefix === 'estimate') ids.estimate_id = asNumber(p.id);
    if (prefix === 'invoice') ids.invoice_id = asNumber(p.id);
    if (prefix === 'customer') ids.customer_id = asNumber(p.id);
    if (prefix === 'product') ids.product_id = asNumber(p.id);
    if (prefix === 'job') ids.job_id = asNumber(p.id);
    if (prefix === 'credit_memo') ids.credit_memo_id = asNumber(p.id);
  }
  return ids;
}

/** True when the webhook already carries enough entity data for policy checks. */
export function payloadIsSubstantive(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Object.keys(payload).length === 0) return false;
  return payload.id != null
    || payload.subTotal != null
    || payload.sub_total != null
    || payload.grossProfitPercentage != null
    || payload.gross_profit_percentage != null
    || (Array.isArray(payload.sections) && payload.sections.length > 0)
    || (Array.isArray(payload.line_items) && payload.line_items.length > 0)
    || (Array.isArray(payload.items) && payload.items.length > 0);
}

export function pickStockQty(product = {}) {
  for (const field of STOCK_FIELDS) {
    if (product[field] != null && product[field] !== '') {
      return { stock_qty: asNumber(product[field]) ?? product[field], stock_field: field };
    }
  }
  return { stock_qty: null, stock_field: null };
}

export function compactProduct(record) {
  if (!record || typeof record !== 'object') return { id: record?.id };
  const stock = pickStockQty(record);
  return {
    id: asNumber(record.id),
    title: record.title ?? record.name,
    sku: record.sku ?? record.product_number ?? record.model_number,
    cost_price: record.cost_price ?? record.costPrice,
    sales_price: record.sales_price ?? record.salesPrice,
    ...stock,
  };
}

/** Walk payload line items (any shape) — used only for enrichment lookups, not to replace payload. */
export function lineItemsFromRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const buckets = [record.line_items, record.items, record.products, record.estimate_items, record.invoice_items];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length > 0) return bucket;
  }
  if (Array.isArray(record.sections)) {
    const fromSections = [];
    for (const section of record.sections) {
      if (!section || typeof section !== 'object') continue;
      const items = section.items || section.line_items;
      if (!Array.isArray(items)) continue;
      for (const item of items) fromSections.push(item);
    }
    if (fromSections.length > 0) return fromSections;
  }
  return [];
}

function productIdsFromLines(lines) {
  return [
    ...new Set(
      lines
        .map((line) => asNumber(
          line.product_id
          ?? line.productId
          ?? line.product_service_id
          ?? line.productServiceId,
        ))
        .filter((id) => id != null),
    ),
  ];
}

export function productIdsFromPayload(payload) {
  return productIdsFromLines(lineItemsFromRecord(payload));
}

export function payloadLinesNeedStockLookup(payload) {
  const lines = lineItemsFromRecord(payload);
  if (lines.length === 0) return false;
  return lines.some((line) => line.availableQty == null && line.available_qty == null);
}

function emptySnapshot(ids) {
  return {
    ids,
    enrichment: {},
    notes: [],
    errors: [],
  };
}

async function showMasterObject(id) {
  const { companyId, userId } = getWorxstreamContext();
  return callWorxstreamAPI({
    method: 'GET',
    endpoint: '/master-objects/show',
    data: { company_id: companyId, user_id: userId, id },
  });
}

async function listMasterObjects(appName, extra = {}) {
  const { companyId, userId } = getWorxstreamContext();
  return callWorxstreamAPI({
    method: 'POST',
    endpoint: '/master-objects/list',
    data: {
      companyId,
      userId,
      appName,
      page: 1,
      limit: extra.limit ?? 1,
      ...extra,
    },
  });
}

async function resolveLatestId(appName, idKey, snapshot) {
  const result = await listMasterObjects(appName, { limit: 1 });
  const row = apiRows(result)[0];
  const id = asNumber(row?.[idKey] ?? row?.id);
  if (id == null) {
    snapshot.errors.push(`Could not resolve ${idKey} — webhook payload was empty and ${appName} list returned no rows.`);
    return null;
  }
  snapshot.notes.push(`${idKey} was missing from the webhook; used most recent ${appName} ${id}.`);
  return id;
}

async function enrichProducts(snapshot, productIds) {
  if (productIds.length === 0) return;
  const { companyId, userId } = getWorxstreamContext();
  const products = await Promise.all(productIds.slice(0, 15).map(async (id) => {
    const result = await callWorxstreamAPI({
      method: 'GET',
      endpoint: '/master/product/product-service-details',
      data: { company_id: companyId, user_id: userId, id },
    });
    const record = apiRecord(result);
    if (!record) {
      snapshot.errors.push(`get_product_details failed for product ${id}.`);
      return { id };
    }
    return compactProduct({ id, ...record });
  }));
  snapshot.enrichment.products = products;
  if (products.some((product) => product.stock_qty == null)) {
    snapshot.notes.push('Some products have no stock field in enrichment. Prefer availableQty on payload line items.');
  }
}

/** Overdue / recent invoices for credit-hold policy — not present on estimate webhooks. */
async function enrichCustomerCredit(snapshot, customerId) {
  if (customerId == null) return;
  snapshot.ids.customer_id = customerId;
  const { companyId, userId } = getWorxstreamContext();
  const invoices = await listMasterObjects('invoice', { customer_id: customerId, limit: 10 });
  snapshot.enrichment.invoices = apiRows(invoices).slice(0, 10);
}

async function enrichFromApiWhenPayloadSparse(snapshot, entityId, prefix) {
  const details = await showMasterObject(entityId);
  const record = apiRecord(details);
  if (!record) {
    snapshot.errors.push(`API fallback failed for ${prefix} ${entityId}.`);
    return;
  }
  snapshot.enrichment.from_api = record;
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  snapshot.notes.push(`Webhook payload was sparse; enrichment.from_api holds the API record. Prefer payload when present.`);
}

async function hydrateDocumentEvent(snapshot, payload, prefix) {
  const idKey = prefix === 'invoice' ? 'invoice_id' : `${prefix}_id`;
  if (snapshot.ids[idKey] == null) {
    snapshot.ids[idKey] = await resolveLatestId(prefix, idKey, snapshot);
  }
  const entityId = snapshot.ids[idKey];
  if (entityId == null) return;

  if (!payloadIsSubstantive(payload)) {
    await enrichFromApiWhenPayloadSparse(snapshot, entityId, prefix);
  }

  const customerId = snapshot.ids.customer_id
    ?? asNumber(payload.customer_id ?? payload.customerId ?? payload.customer?.customerId);
  const productIds = productIdsFromPayload(payload);
  const needsStock = payloadLinesNeedStockLookup(payload)
    || (!payloadIsSubstantive(payload) && productIds.length > 0);

  const tasks = [];
  if (needsStock && productIds.length > 0) {
    tasks.push(enrichProducts(snapshot, productIds));
  }
  if (customerId != null) {
    tasks.push(enrichCustomerCredit(snapshot, customerId));
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

async function hydrateProductEvent(snapshot, payload) {
  if (payloadIsSubstantive(payload)) return;
  if (snapshot.ids.product_id == null) return;
  const { companyId, userId } = getWorxstreamContext();
  const result = await callWorxstreamAPI({
    method: 'GET',
    endpoint: '/master/product/product-service-details',
    data: { company_id: companyId, user_id: userId, id: snapshot.ids.product_id },
  });
  const record = apiRecord(result);
  if (!record) {
    snapshot.errors.push(`get_product_details failed for product ${snapshot.ids.product_id}.`);
    return;
  }
  snapshot.enrichment.from_api = record;
  snapshot.enrichment.products = [compactProduct({ id: snapshot.ids.product_id, ...record })];
}

async function hydrateJobEvent(snapshot, payload) {
  if (payloadIsSubstantive(payload)) {
    const customerId = snapshot.ids.customer_id
      ?? asNumber(payload.customer_id ?? payload.customerId);
    if (customerId != null) await enrichCustomerCredit(snapshot, customerId);
    return;
  }
  if (snapshot.ids.job_id == null) return;
  const { companyId, userId } = getWorxstreamContext();
  const result = await callWorxstreamAPI({
    method: 'GET',
    endpoint: '/transaction/job/get-job-details',
    data: { company_id: companyId, user_id: userId, id: snapshot.ids.job_id },
  });
  const record = apiRecord(result);
  if (!record) {
    snapshot.errors.push(`get_job_details failed for job ${snapshot.ids.job_id}.`);
    return;
  }
  snapshot.enrichment.from_api = record;
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  await enrichCustomerCredit(snapshot, snapshot.ids.customer_id);
}

async function refreshLiveEntity(snapshot, payload, prefix) {
  if (prefix === 'estimate' || prefix === 'invoice' || prefix === 'credit_memo') {
    const idKey = prefix === 'invoice' ? 'invoice_id' : `${prefix}_id`;
    if (snapshot.ids[idKey] == null) snapshot.ids[idKey] = asNumber(payload.id);
    const entityId = snapshot.ids[idKey];
    if (entityId == null) {
      snapshot.errors.push(`Cannot refresh ${prefix}: missing id.`);
      return;
    }
    const details = await showMasterObject(entityId);
    const record = apiRecord(details);
    if (!record) {
      snapshot.errors.push(`Live refresh failed for ${prefix} ${entityId}.`);
      return;
    }
    snapshot.enrichment.from_api = record;
    snapshot.ids.customer_id = snapshot.ids.customer_id
      ?? asNumber(record.customer_id ?? record.customerId);
    snapshot.notes.push(`Sentinel refreshed ${prefix} ${entityId} from WorxStream.`);
    return;
  }

  if (prefix === 'customer') {
    if (snapshot.ids.customer_id == null) snapshot.ids.customer_id = asNumber(payload.id);
    if (snapshot.ids.customer_id == null) {
      snapshot.errors.push('Cannot refresh customer: missing id.');
      return;
    }
    const details = await showMasterObject(snapshot.ids.customer_id);
    const record = apiRecord(details);
    if (record) snapshot.enrichment.from_api = record;
    snapshot.notes.push(`Sentinel refreshed customer ${snapshot.ids.customer_id} from WorxStream.`);
    return;
  }

  if (prefix === 'product') {
    if (snapshot.ids.product_id == null) snapshot.ids.product_id = asNumber(payload.id);
    await hydrateProductEvent(snapshot, {});
    return;
  }

  if (prefix === 'job') {
    if (snapshot.ids.job_id == null) snapshot.ids.job_id = asNumber(payload.id);
    const jobId = snapshot.ids.job_id;
    if (jobId == null) {
      snapshot.errors.push('Cannot refresh job: missing id.');
      return;
    }
    const { companyId, userId } = getWorxstreamContext();
    const result = await callWorxstreamAPI({
      method: 'GET',
      endpoint: '/transaction/job/get-job-details',
      data: { company_id: companyId, user_id: userId, id: jobId },
    });
    const record = apiRecord(result);
    if (!record) {
      snapshot.errors.push(`Live refresh failed for job ${jobId}.`);
      return;
    }
    snapshot.enrichment.from_api = record;
    snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
    snapshot.notes.push(`Sentinel refreshed job ${jobId} from WorxStream.`);
  }
}

/**
 * @returns {Promise<{ payload: object, snapshot: object }>}
 */
export async function hydrateSharedContext({ eventType, payload, refreshEntity = false }) {
  const eventPayload = payload && typeof payload === 'object' ? payload : {};
  const ids = extractEntityIds(eventPayload, eventType);
  const snapshot = emptySnapshot(ids);
  const prefix = String(eventType || '').split('.')[0];

  try {
    if (refreshEntity) {
      await refreshLiveEntity(snapshot, eventPayload, prefix);
      const live = snapshot.enrichment.from_api;
      const working = live && typeof live === 'object' && !Array.isArray(live)
        ? { ...live }
        : { ...eventPayload };
      for (const [key, value] of Object.entries(snapshot.ids)) {
        if (value != null && working[key] == null) working[key] = value;
      }
      const customerId = snapshot.ids.customer_id
        ?? asNumber(working.customer_id ?? working.customerId ?? working.customer?.customerId);
      const productIds = productIdsFromPayload(working);
      const tasks = [];
      if (productIds.length > 0 && (payloadLinesNeedStockLookup(working) || refreshEntity)) {
        tasks.push(enrichProducts(snapshot, productIds));
      }
      if (customerId != null && prefix !== 'product') {
        tasks.push(enrichCustomerCredit(snapshot, customerId));
      }
      if (tasks.length > 0) await Promise.all(tasks);
      return { payload: working, snapshot };
    }

    if (prefix === 'estimate' || prefix === 'invoice' || prefix === 'credit_memo') {
      await hydrateDocumentEvent(snapshot, eventPayload, prefix);
    } else if (prefix === 'customer') {
      await enrichCustomerCredit(snapshot, ids.customer_id);
    } else if (prefix === 'product') {
      await hydrateProductEvent(snapshot, eventPayload);
    } else if (prefix === 'job') {
      await hydrateJobEvent(snapshot, eventPayload);
    }
  } catch (error) {
    snapshot.errors.push(error.message || String(error));
  }

  const merged = { ...eventPayload };
  for (const [key, value] of Object.entries(snapshot.ids)) {
    if (value != null && merged[key] == null) merged[key] = value;
  }
  if (eventPayload.customNumber != null && merged.custom_number == null) {
    merged.custom_number = eventPayload.customNumber;
  }

  return { payload: merged, snapshot };
}
