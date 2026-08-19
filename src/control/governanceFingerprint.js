/**
 * Stable fingerprints so Sentinel can skip Aegis re-evals when nothing
 * material changed (live entity, stock/credit enrichment, or catalog).
 */

import { createHash } from 'crypto';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import { extractEntityIds, lineItemsFromRecord } from './hydrateSharedContext.js';

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function asScalar(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== '') return n;
  return String(value);
}

function stableLine(line) {
  if (!line || typeof line !== 'object') return null;
  return {
    product: asScalar(
      line.product_id
      ?? line.productId
      ?? line.product_service_id
      ?? line.productServiceId,
    ),
    qty: asScalar(line.quantity ?? line.qty ?? line.qty_ordered),
    price: asScalar(line.price ?? line.sales_price ?? line.unitPrice ?? line.unit_price),
    margin: asScalar(line.grossProfitPercentage ?? line.margin ?? line.itemMargin),
  };
}

export function entityKeyFromRun(eventType, payload) {
  const ids = extractEntityIds(payload, eventType);
  const prefix = String(eventType || '').split('.')[0];
  const id = ids[`${prefix}_id`]
    ?? ids.estimate_id
    ?? ids.invoice_id
    ?? ids.customer_id
    ?? ids.product_id
    ?? ids.job_id
    ?? ids.credit_memo_id;
  if (id == null) return null;
  return `${prefix}:${id}`;
}

export function payloadFingerprint(payload, snapshot) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const invoices = Array.isArray(snapshot?.enrichment?.invoices) ? snapshot.enrichment.invoices : [];
  const products = Array.isArray(snapshot?.enrichment?.products) ? snapshot.enrichment.products : [];
  return hashValue({
    id: asScalar(p.id ?? p.estimate_id ?? p.invoice_id ?? p.customer_id ?? p.product_id),
    status: asScalar(p.statusCode ?? p.status_code ?? p.status),
    grandTotal: asScalar(p.grandTotal ?? p.grand_total),
    subTotal: asScalar(p.subTotal ?? p.sub_total),
    grossProfitPercentage: asScalar(p.grossProfitPercentage ?? p.gross_profit_percentage),
    totalAppliedCost: asScalar(p.totalAppliedCost ?? p.total_applied_cost),
    customerId: asScalar(p.customer_id ?? p.customerId ?? p.customer?.customerId),
    items: lineItemsFromRecord(p).map(stableLine).filter(Boolean),
    overdue: invoices.map((row) => asScalar(row.id ?? row.invoice_id)).filter((id) => id != null).slice(0, 20),
    stock: products.map((row) => ({
      id: asScalar(row.id),
      stock_qty: asScalar(row.stock_qty),
    })),
  });
}

export async function catalogFingerprint(companyId) {
  const company_id = String(companyId);
  const [policies, rules] = await Promise.all([
    GovernancePolicy.find({ company_id, status: 'active' }).select('_id updated_at').lean(),
    GovernanceRule.find({ company_id, active: true }).select('_id updated_at').lean(),
  ]);
  const rows = [
    ...(policies || []).map((row) => `p:${row._id}:${new Date(row.updated_at || 0).toISOString()}`),
    ...(rules || []).map((row) => `r:${row._id}:${new Date(row.updated_at || 0).toISOString()}`),
  ].sort();
  return hashValue(rows);
}
