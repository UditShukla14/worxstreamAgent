/**
 * Fetch the event entity once and share it with every governance master.
 * Webhook payloads are often empty; masters must not each list/get the same record.
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

const ESTIMATE_KEYS = [
  'id', 'estimate_id', 'estimate_number', 'custom_number', 'number', 'status',
  'customer_id', 'customer_name', 'contact_id', 'name',
  'grand_total', 'sub_total', 'subtotal', 'total', 'tax',
  'cost_of_goods', 'contract_cost', 'margin', 'margin_pct', 'gross_profit',
];

const INVOICE_KEYS = [
  'id', 'invoice_id', 'invoice_number', 'custom_number', 'number', 'status',
  'customer_id', 'customer_name', 'grand_total', 'sub_total', 'balance',
  'due_date', 'issue_date', 'paid', 'overdue',
];

const CUSTOMER_KEYS = [
  'id', 'customer_id', 'first_name', 'last_name', 'name', 'email',
  'phone_number', 'credit_hold', 'credit_limit', 'balance', 'tags',
];

const PRODUCT_KEYS = [
  'id', 'title', 'name', 'product_number', 'model_number', 'sku',
  'type', 'cost_price', 'sales_price', 'margin', 'is_active',
];

const LINE_KEYS = [
  'product_id', 'productId', 'name', 'title', 'sku', 'product_number',
  'model_number', 'quantity', 'qty', 'unit_price', 'sales_price',
  'cost', 'cost_price', 'contract_cost',
];

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(record, keys) {
  const out = {};
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
  for (const key of keys) {
    const value = record[key];
    if (value != null && value !== '') out[key] = value;
  }
  return out;
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
    customer_id: asNumber(p.customer_id ?? p.customerId),
    product_id: asNumber(p.product_id ?? p.productId),
    job_id: asNumber(p.job_id ?? p.jobId),
    credit_memo_id: asNumber(p.credit_memo_id ?? p.creditMemoId),
  };
  const prefix = String(eventType).split('.')[0];
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

export function pickStockQty(product = {}) {
  for (const field of STOCK_FIELDS) {
    if (product[field] != null && product[field] !== '') {
      return { stock_qty: asNumber(product[field]) ?? product[field], stock_field: field };
    }
  }
  return { stock_qty: null, stock_field: null };
}

export function compactProduct(record) {
  const base = pick(record, PRODUCT_KEYS);
  const stock = pickStockQty(record);
  return { ...base, ...stock };
}

function compactLineItem(record) {
  const line = pick(record, LINE_KEYS);
  const productId = asNumber(record.product_id ?? record.productId);
  if (productId != null) line.product_id = productId;
  const qty = asNumber(record.quantity ?? record.qty);
  if (qty != null) line.quantity = qty;
  return line;
}

function lineItemsFromRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const buckets = [record.line_items, record.items, record.products, record.estimate_items, record.invoice_items];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length > 0) return bucket.map(compactLineItem);
  }
  return [];
}

function customerName(record) {
  if (!record || typeof record !== 'object') return '';
  if (record.name) return String(record.name);
  const parts = [record.first_name, record.last_name].filter(Boolean);
  return parts.join(' ').trim();
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

async function hydrateProducts(snapshot, lines) {
  const ids = [...new Set(lines.map((line) => asNumber(line.product_id)).filter((id) => id != null))].slice(0, 15);
  const { companyId, userId } = getWorxstreamContext();
  const products = await Promise.all(ids.map(async (id) => {
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
  snapshot.products = products;
  if (products.some((product) => product.stock_qty == null)) {
    snapshot.notes.push('Some products have no stock field (qty / quantity_on_hand). Use stock_qty from the snapshot; do not re-fetch.');
  }
}

async function hydrateCustomerBundle(snapshot, customerId) {
  if (customerId == null) return;
  snapshot.ids.customer_id = customerId;
  const { companyId, userId } = getWorxstreamContext();
  const [details, invoices] = await Promise.all([
    callWorxstreamAPI({
      method: 'GET',
      endpoint: '/master/customer/customer-details',
      data: { company_id: companyId, user_id: userId, id: customerId },
    }),
    listMasterObjects('invoice', { customer_id: customerId, limit: 10 }),
  ]);
  const customer = apiRecord(details);
  if (customer) {
    const compact = pick(customer, CUSTOMER_KEYS);
    compact.id = asNumber(customer.customer_id ?? customer.customerId ?? customer.id) ?? customerId;
    compact.name = customerName(customer) || compact.name;
    snapshot.customer = compact;
  } else {
    snapshot.errors.push(`get_customer_details failed for customer ${customerId}.`);
  }
  snapshot.invoices = apiRows(invoices).slice(0, 10).map((row) => pick(row, INVOICE_KEYS));
}

async function hydrateEstimate(snapshot) {
  if (snapshot.ids.estimate_id == null) {
    snapshot.ids.estimate_id = await resolveLatestId('estimate', 'estimate_id', snapshot);
  }
  const estimateId = snapshot.ids.estimate_id;
  if (estimateId == null) return;

  const [details, lineReport] = await Promise.all([
    showMasterObject(estimateId),
    callWorxstreamAPI({
      method: 'POST',
      endpoint: '/report/estimate/line-items',
      data: {
        company_id: getWorxstreamContext().companyId,
        user_id: getWorxstreamContext().userId,
        object_name: 'estimate',
        object_id: estimateId,
      },
    }),
  ]);

  const record = apiRecord(details);
  if (!record) {
    snapshot.errors.push(`get_estimate_details failed for estimate ${estimateId}.`);
    return;
  }
  snapshot.entity = { type: 'estimate', ...pick(record, ESTIMATE_KEYS) };
  snapshot.entity.id = estimateId;
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  if (record.estimate_number || record.custom_number || record.number) {
    snapshot.ids.estimate_number = record.estimate_number || record.custom_number || record.number;
  }

  const fromRecord = lineItemsFromRecord(record);
  const fromReport = apiRows(lineReport).map(compactLineItem);
  snapshot.line_items = fromRecord.length > 0 ? fromRecord : fromReport;
  await Promise.all([
    hydrateProducts(snapshot, snapshot.line_items),
    hydrateCustomerBundle(snapshot, snapshot.ids.customer_id),
  ]);
}

async function hydrateInvoice(snapshot) {
  if (snapshot.ids.invoice_id == null) {
    snapshot.ids.invoice_id = await resolveLatestId('invoice', 'invoice_id', snapshot);
  }
  const invoiceId = snapshot.ids.invoice_id;
  if (invoiceId == null) return;
  const details = await showMasterObject(invoiceId);
  const record = apiRecord(details);
  if (!record) {
    snapshot.errors.push(`get_invoice_details failed for invoice ${invoiceId}.`);
    return;
  }
  snapshot.entity = { type: 'invoice', ...pick(record, INVOICE_KEYS) };
  snapshot.entity.id = invoiceId;
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  snapshot.line_items = lineItemsFromRecord(record);
  await Promise.all([
    hydrateProducts(snapshot, snapshot.line_items),
    hydrateCustomerBundle(snapshot, snapshot.ids.customer_id),
  ]);
}

async function hydrateProductEvent(snapshot) {
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
  const product = compactProduct({ id: snapshot.ids.product_id, ...record });
  snapshot.entity = { type: 'product', ...product };
  snapshot.products = [product];
}

async function hydrateJob(snapshot) {
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
  snapshot.entity = {
    type: 'job',
    id: snapshot.ids.job_id,
    ...pick(record, ['id', 'job_name', 'status', 'customer_id', 'contact_id', 'description']),
  };
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  await hydrateCustomerBundle(snapshot, snapshot.ids.customer_id);
}

async function hydrateCreditMemo(snapshot) {
  if (snapshot.ids.credit_memo_id == null) {
    snapshot.ids.credit_memo_id = await resolveLatestId('credit_memo', 'credit_memo_id', snapshot);
  }
  const id = snapshot.ids.credit_memo_id;
  if (id == null) return;
  const details = await showMasterObject(id);
  const record = apiRecord(details);
  if (!record) {
    snapshot.errors.push(`get_credit_memo_details failed for credit memo ${id}.`);
    return;
  }
  snapshot.entity = { type: 'credit_memo', id, ...pick(record, INVOICE_KEYS) };
  snapshot.ids.customer_id = snapshot.ids.customer_id ?? asNumber(record.customer_id ?? record.customerId);
  await hydrateCustomerBundle(snapshot, snapshot.ids.customer_id);
}

function emptySnapshot(ids) {
  return {
    ids,
    entity: null,
    line_items: [],
    products: [],
    customer: null,
    invoices: [],
    notes: [],
    errors: [],
  };
}

/**
 * @returns {Promise<{ payload: object, snapshot: object }>}
 */
export async function hydrateSharedContext({ eventType, payload }) {
  const ids = extractEntityIds(payload, eventType);
  const snapshot = emptySnapshot(ids);
  const prefix = String(eventType || '').split('.')[0];

  try {
    if (prefix === 'estimate') await hydrateEstimate(snapshot);
    else if (prefix === 'invoice') await hydrateInvoice(snapshot);
    else if (prefix === 'customer') await hydrateCustomerBundle(snapshot, ids.customer_id);
    else if (prefix === 'product') await hydrateProductEvent(snapshot);
    else if (prefix === 'job') await hydrateJob(snapshot);
    else if (prefix === 'credit_memo') await hydrateCreditMemo(snapshot);
  } catch (error) {
    snapshot.errors.push(error.message || String(error));
  }

  const merged = { ...(payload && typeof payload === 'object' ? payload : {}) };
  for (const [key, value] of Object.entries(snapshot.ids)) {
    if (value != null && merged[key] == null) merged[key] = value;
  }
  if (snapshot.customer?.name && !merged.customer_name) merged.customer_name = snapshot.customer.name;
  if (snapshot.entity?.estimate_number && !merged.estimate_number) {
    merged.estimate_number = snapshot.entity.estimate_number;
  }

  return { payload: merged, snapshot };
}
