/**
 * Build the user message for Aegis from a webhook event.
 */

import { getGovernanceAgentName } from './governanceAgents.js';
import { catalogForEvent, getCatalogContext } from './catalogContext.js';
import { ruleAppliesToEvent } from './ruleEvents.js';
import { normalizeEventType } from './pipelineConfig.js';

function firstLabel(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function eventKind(eventType) {
  return normalizeEventType(eventType).split('.')[0] || '';
}

/**
 * Human label for the Runs table. WorxStream uses customNumber on estimates
 * AND invoices — do not treat that field as estimate-only. Prefer event_type.
 */
export function entityLabelFromPayload(payload = {}, eventType = '') {
  const p = payload && typeof payload === 'object' ? payload : {};
  const kind = eventKind(eventType);
  const docNumber = firstLabel(
    p.invoice_number,
    p.estimate_number,
    p.credit_memo_number,
    p.custom_number,
    p.customNumber,
  );

  if (kind === 'invoice' || (kind !== 'estimate' && (p.invoice_id != null || p.invoice_number))) {
    const num = firstLabel(p.invoice_number, docNumber, p.invoice_id);
    if (num) return `Invoice #${num}`;
  }
  if (kind === 'estimate' || p.estimate_id != null || p.estimate_number) {
    const num = firstLabel(p.estimate_number, p.custom_number, p.customNumber, p.estimate_id);
    if (num) return `Estimate #${num}`;
  }
  if (kind === 'credit_memo' || p.credit_memo_id != null) {
    const num = firstLabel(p.credit_memo_number, docNumber, p.credit_memo_id);
    if (num) return `Credit Memo #${num}`;
  }
  if (kind === 'job' || p.job_id != null) {
    const num = firstLabel(p.job_number, docNumber, p.job_id);
    if (num) return `Job #${num}`;
  }
  if (kind === 'product' || p.product_id != null) {
    const title = firstLabel(p.title, p.name, p.sku);
    if (title && p.product_id != null) return `${title} (Product #${p.product_id})`;
    if (p.product_id != null) return `Product #${p.product_id}`;
    if (title) return title;
  }
  if (kind === 'customer' || p.customer_id != null) {
    const name = firstLabel(p.customer_name, p.name, p.customer?.name, p.customer?.customerName);
    const id = p.customer_id ?? p.customer?.customer_id ?? p.customer?.customerId;
    if (name && id != null) return `${name} (Customer #${id})`;
    if (id != null) return `Customer #${id}`;
    if (name) return name;
  }
  if (kind === 'purchase_order' || p.purchase_order_id != null) {
    const num = firstLabel(p.purchase_order_number, docNumber, p.purchase_order_id);
    if (num) return `Purchase Order #${num}`;
  }
  if (kind && docNumber) {
    const noun = kind.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    return `${noun} #${docNumber}`;
  }
  if (docNumber) return `Document #${docNumber}`;
  return eventType || 'Unknown entity';
}

function customerTypeLabel(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const label = String(value).trim();
    if (!label || /^\d+$/.test(label)) return '';
    return label;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  const label = String(value.label || value.value || value.name || value.type || '').trim();
  if (!label || /^\d+$/.test(label)) return '';
  return label;
}

/** Human customer type from a WorxStream payload (Reseller, Contractor, …). Skips raw IDs. */
export function customerTypeFromPayload(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const customer = p.customer && typeof p.customer === 'object' ? p.customer : {};
  const candidates = [
    customer.customerType,
    customer.customer_type,
    customer.type_of_customer,
    customer.typeOfCustomer,
    p.customerType,
    p.customer_type,
    p.type_of_customer,
    p.typeOfCustomer,
  ];
  for (const candidate of candidates) {
    const label = customerTypeLabel(candidate);
    if (label) return label;
  }
  return '';
}

function personLabel(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const label = String(value).trim();
    if (!label || /^\d+$/.test(label)) return '';
    return label;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  const name = String(value.name || value.fullName || value.full_name || '').trim();
  const email = String(value.email || '').trim();
  const label = String(value.label || value.value || '').trim();
  const combined = name || email || label;
  if (!combined || /^\d+$/.test(combined)) return '';
  return combined;
}

/** Document author from a WorxStream payload. Prefers preparedBy, then createdBy name. Skips raw IDs. */
export function preparedByFromPayload(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const candidates = [
    p.preparedBy,
    p.prepared_by,
    p.preparedByDetails,
    p.prepared_by_details,
    p.createdBy,
    p.created_by,
    p.created_by_user_name,
    p.createdByUserName,
  ];
  for (const candidate of candidates) {
    const label = personLabel(candidate);
    if (label) return label;
  }
  return '';
}

/**
 * Active catalog for this run, from the persistent company context.
 * Mongo is not queried unless the context is empty or was invalidated.
 */
export async function loadPolicyCatalog(companyId, eventType) {
  const snapshot = await getCatalogContext(companyId);
  return catalogForEvent(snapshot, eventType);
}

/** One UI/pipeline step per active policy and applicable rule. */
export function catalogCheckItems(catalog) {
  const policies = Array.isArray(catalog?.policies) ? catalog.policies : [];
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : [];
  return [
    ...policies.map((row) => ({
      kind: 'policy',
      id: row.id != null ? String(row.id) : '',
      name: String(row.name || '').trim(),
    })),
    ...rules.map((row) => ({
      kind: 'rule',
      id: row.id != null ? String(row.id) : '',
      name: String(row.name || '').trim(),
    })),
  ].filter((row) => row.name);
}

export function buildMasterMessage({
  eventType,
  payload,
  companyId,
  agentKey,
  snapshot,
  catalog,
}) {
  const label = entityLabelFromPayload(payload, eventType);
  const catalogBlock = formatCatalog(catalog, eventType);
  const payloadBlock = [
    'WORXSTREAM EVENT PAYLOAD (source of truth — use these values exactly as the user sees them in the app):',
    JSON.stringify(payload || {}, null, 2),
  ].join('\n');
  const snapshotBlock = snapshot
    ? [
      'SUPPLEMENTARY ENRICHMENT (credit invoices, product stock — only when missing from payload; never override payload fields):',
      JSON.stringify(snapshot, null, 2),
    ].join('\n')
    : 'SUPPLEMENTARY ENRICHMENT: (not available)';

  return [
    `Governance check for ${getGovernanceAgentName(agentKey)}.`,
    `Event type: ${eventType}`,
    `Company ID: ${companyId}`,
    `Entity: ${label}`,
    '',
    'CATALOG CHECK (mandatory first step): the LIVE GOVERNANCE CATALOG below was loaded from Control Tower at the start of this run. It contains only active policies and active rules that apply to this event. Evaluate those items and nothing else.',
    '',
    payloadBlock,
    '',
    snapshotBlock,
    '',
    catalogBlock,
    '',
    'Use grossProfitPercentage, subTotal, grandTotal, totalAppliedCost, sections, and customer from the event payload — do not recalculate margins or totals.',
    'Use the supplementary enrichment only for data missing from the payload (e.g. overdue invoice counts in enrichment.invoices, product stock_qty).',
    'Do not call list_estimates, list_invoices, get_estimate_details, get_invoice_details, get_product_details, get_customer_details, get_estimate_line_items, or invoke_agent to rediscover payload fields.',
    'Product stock may appear on payload line items (availableQty) or in enrichment.products[].stock_qty.',
    'Only call tools for a fact neither the payload nor snapshot provides.',
    'Do not invent policies, rules, numeric defaults, or extra checks. If the live catalog is empty, return {"verdict":"pass","findings":[]}.',
    'Evaluate every live-catalog item that applies to this event. Return the JSON output contract only.',
  ].join('\n');
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function formatCatalog(catalog, eventType) {
  const policies = Array.isArray(catalog?.policies) ? catalog.policies : [];
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : [];
  const header = 'LIVE GOVERNANCE CATALOG (loaded from Control Tower at the start of this run — the only legal set of checks):';
  if (policies.length === 0 && rules.length === 0) {
    return `${header}\n(none active — do not invent policies, rules, checks, or default thresholds. Return {"verdict":"pass","findings":[]})`;
  }

  const policyLines = policies.map((row) => {
    const updated = formatTimestamp(row.updatedAt || row.updated_at);
    const stamp = updated ? ` updated ${updated}` : '';
    const body = String(row.content || '').trim()
      || '(no content — skip this policy; do not invent a rule for it)';
    return `--- policy: ${row.name}${stamp} ---\n${body}`;
  });

  const ruleLines = rules.map((row) => {
    const eventTypes = Array.isArray(row.eventTypes) && row.eventTypes.length
      ? row.eventTypes
      : (row.eventType ? [row.eventType] : []);
    const applies = ruleAppliesToEvent(row, eventType) ? ' [applies to this event]' : '';
    const eventsLabel = eventTypes.length > 0 ? eventTypes.join(', ') : 'any';
    const updated = formatTimestamp(row.updatedAt || row.updated_at);
    const stamp = updated ? ` updated ${updated}` : '';
    const when = String(row.condition || '').trim()
      || '(missing condition — skip this rule; do not invent one)';
    const then = String(row.action || '').trim()
      || '(missing action — skip this rule; do not invent one)';
    return `--- rule: ${row.name} (${eventsLabel})${applies}${stamp} ---\nWhen: ${when}\nThen: ${then}`;
  });

  return [
    header,
    'Evaluate every item below that applies to this event_type. Do not add any other policy, rule, threshold, or check.',
    '',
    'Active policies:',
    ...policyLines,
    '',
    'Active rules:',
    ...ruleLines,
  ].join('\n');
}
