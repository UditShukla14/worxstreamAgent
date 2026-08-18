/**
 * event_type → Aegis. One agent evaluates all policies/rules for the event.
 * Adding a policy does not require a new pipeline agent.
 */

import { AEGIS_AGENT_KEY } from './governanceAgents.js';

const AEGIS_PIPELINE = [AEGIS_AGENT_KEY];

export const PIPELINE_BY_EVENT = {
  'estimate.created': AEGIS_PIPELINE,
  'estimate.updated': AEGIS_PIPELINE,
  'invoice.created': AEGIS_PIPELINE,
  'invoice.updated': AEGIS_PIPELINE,
  'invoice.paid': AEGIS_PIPELINE,
  'customer.created': AEGIS_PIPELINE,
  'customer.updated': AEGIS_PIPELINE,
  'product.updated': AEGIS_PIPELINE,
  'job.created': AEGIS_PIPELINE,
  'credit_memo.created': AEGIS_PIPELINE,
};

/**
 * Worxstream catalog uses snake_case (`estimate_created`) or camelCase (`estimateCreated`);
 * pipelines use dotted types. `credit_memo_created` / `creditMemoCreated` → `credit_memo.created`.
 */
export function normalizeEventType(eventType) {
  let raw = String(eventType || '').trim();
  if (!raw) return '';
  if (raw.includes('.')) return raw;
  if (/[A-Z]/.test(raw) && !raw.includes('_')) {
    raw = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
  }
  const match = raw.match(/^(.*)_(created|updated|paid|deleted)$/i);
  if (match) return `${match[1]}.${match[2].toLowerCase()}`;
  return raw;
}

export function getPipelineForEvent(eventType) {
  const key = normalizeEventType(eventType);
  const pipeline = PIPELINE_BY_EVENT[key];
  return Array.isArray(pipeline) ? [...pipeline] : [];
}

export function listPipelines() {
  return Object.entries(PIPELINE_BY_EVENT).map(([eventType, agents]) => ({
    eventType,
    agents: [...agents],
  }));
}

export function countActivePipelines() {
  return Object.keys(PIPELINE_BY_EVENT).length;
}
