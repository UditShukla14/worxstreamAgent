/**
 * Build the user message + RAG query for Aegis from a webhook event.
 */

import { getGovernanceAgentName } from './governanceAgents.js';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import { eventTypesFromRule, ruleAppliesToEvent } from './ruleEvents.js';

export function entityLabelFromPayload(payload = {}, eventType = '') {
  const p = payload && typeof payload === 'object' ? payload : {};
  const estimateNumber = p.estimate_number || p.custom_number || p.customNumber;
  if (estimateNumber) return `Estimate #${estimateNumber}`;
  if (p.estimate_id != null) return `Estimate #${p.estimate_id}`;
  const invoiceNumber = p.invoice_number;
  if (invoiceNumber) return `Invoice #${invoiceNumber}`;
  if (p.invoice_id != null) return `Invoice #${p.invoice_id}`;
  if (p.product_id != null) return `Product #${p.product_id}`;
  if (p.job_id != null) return `Job #${p.job_id}`;
  if (p.credit_memo_id != null) return `Credit Memo #${p.credit_memo_id}`;
  if (p.purchase_order_id != null) return `Purchase Order #${p.purchase_order_id}`;
  if (p.customer_id != null) {
    const name = p.customer_name || p.name;
    return name ? `${name} (Customer #${p.customer_id})` : `Customer #${p.customer_id}`;
  }
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

export function buildRagQuery(eventType, agentKey, payload = {}) {
  const agentName = getGovernanceAgentName(agentKey);
  const p = payload && typeof payload === 'object' ? payload : {};
  const bits = [
    agentName,
    agentKey,
    eventType,
    'policy',
    'rule',
    'margin',
    'inventory',
    'credit',
    'stock',
    'overdue',
  ];
  if (String(eventType).includes('estimate') || p.estimate_id != null) {
    bits.push('estimate', 'fulfilment');
  }
  if (String(eventType).includes('invoice') || p.invoice_id != null) {
    bits.push('invoice');
  }
  if (String(eventType).includes('customer') || p.customer_id != null) {
    bits.push('customer', 'hold');
  }
  if (String(eventType).includes('product') || p.product_id != null) {
    bits.push('product', 'reorder');
  }
  return bits.join(' ');
}

export async function loadPolicyCatalog(companyId) {
  const [policies, rules] = await Promise.all([
    GovernancePolicy.find({ company_id: String(companyId), status: 'active' }).select('name type').lean(),
    GovernanceRule.find({ company_id: String(companyId), active: true }).select('name event_type event_types').lean(),
  ]);
  return {
    policies: (policies || []).map((row) => ({ name: row.name, type: row.type || 'policy' })),
    rules: (rules || []).map((row) => {
      const eventTypes = eventTypesFromRule(row);
      return {
        name: row.name,
        eventType: eventTypes[0] || row.event_type,
        eventTypes,
      };
    }),
  };
}

export function buildMasterMessage({
  eventType,
  payload,
  companyId,
  ragChunks,
  agentKey,
  snapshot,
  catalog,
}) {
  const label = entityLabelFromPayload(payload, eventType);
  const policyBlock = formatRagChunks(ragChunks);
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
    payloadBlock,
    '',
    snapshotBlock,
    '',
    catalogBlock,
    '',
    policyBlock,
    '',
    'Use grossProfitPercentage, subTotal, grandTotal, totalAppliedCost, sections, and customer from the event payload — do not recalculate margins or totals.',
    'Use the supplementary enrichment only for data missing from the payload (e.g. overdue invoice counts in enrichment.invoices, product stock_qty).',
    'Do not call list_estimates, list_invoices, get_estimate_details, get_invoice_details, get_product_details, get_customer_details, get_estimate_line_items, or invoke_agent to rediscover payload fields.',
    'Product stock may appear on payload line items (availableQty) or in enrichment.products[].stock_qty.',
    'Only call tools for a fact neither the payload nor snapshot provides.',
    'Evaluate every catalog policy/rule that applies to this event. Return the JSON output contract only.',
  ].join('\n');
}

function formatCatalog(catalog, eventType) {
  const policies = Array.isArray(catalog?.policies) ? catalog.policies : [];
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : [];
  if (policies.length === 0 && rules.length === 0) {
    return 'Policy catalog:\n(none active — use default thresholds)';
  }
  const policyLines = policies.map((row) => `- policy: ${row.name}`);
  const ruleLines = rules.map((row) => {
    const eventTypes = Array.isArray(row.eventTypes) && row.eventTypes.length
      ? row.eventTypes
      : (row.eventType ? [row.eventType] : []);
    const applies = ruleAppliesToEvent(row, eventType) ? ' [applies to this event]' : '';
    const eventsLabel = eventTypes.length > 0 ? eventTypes.join(', ') : 'any';
    return `- rule: ${row.name} (${eventsLabel})${applies}`;
  });
  return ['Active policy catalog (evaluate every item that applies):', ...policyLines, ...ruleLines].join('\n');
}

function formatRagChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return 'Policy/rule text:\n(none retrieved — apply default thresholds in your system prompt)';
  }
  const body = chunks.map((chunk, i) => {
    const title = chunk.name || chunk.document_id || `chunk ${i + 1}`;
    const kind = chunk.document_type || 'policy';
    return `--- ${kind}: ${title} ---\n${chunk.text}`;
  }).join('\n\n');
  return `Policy/rule text:\n${body}`;
}
