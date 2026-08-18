/**
 * Map a Worxstream webhook delivery (Control Tower list API) into a
 * governance pipeline event.
 */

import { normalizeEventType } from './pipelineConfig.js';

const ENVELOPE_KEYS = new Set([
  'event_type',
  'eventType',
  'event_id',
  'eventId',
  'event_code',
  'eventCode',
  'timestamp',
  'company_id',
  'companyId',
  'user_id',
  'userId',
  'payload',
  'data',
]);

function asObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
}

function isNonEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function objectIdKey(objectType) {
  const type = String(objectType || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!type) return null;
  return `${type}_id`;
}

/**
 * @param {object} delivery
 * @param {{ companyId: string, userId?: string }} ids
 */
export function eventFromWorxstreamDelivery(delivery, ids) {
  const row = delivery && typeof delivery === 'object' ? delivery : {};
  const raw = asObject(row.requestPayload)
    || asObject(row.request_payload)
    || {};
  const nestedCandidate = asObject(raw.payload) || asObject(raw.data);
  const nested = isNonEmptyObject(nestedCandidate) ? nestedCandidate : null;

  const payload = nested ? { ...nested } : {};
  if (!nested) {
    for (const [key, value] of Object.entries(raw)) {
      if (!ENVELOPE_KEYS.has(key)) payload[key] = value;
    }
  }

  const eventType = normalizeEventType(
    raw.event_type
      || raw.eventType
      || row.eventCode
      || row.event_code
      || '',
  );

  const objectType = row.objectType || row.object_type || eventType.split('.')[0];
  const objectId = row.objectId ?? row.object_id;
  const idKey = objectIdKey(objectType);
  if (idKey && objectId != null && payload[idKey] == null) {
    payload[idKey] = objectId;
  }

  const eventId = String(
    raw.event_id
      || raw.eventId
      || row.deliveryId
      || row.delivery_id
      || '',
  ).trim();

  return {
    event_type: eventType,
    event_id: eventId,
    timestamp: raw.timestamp
      || row.sentAt
      || row.sent_at
      || row.createdAt
      || row.created_at
      || new Date().toISOString(),
    company_id: String(ids.companyId),
    user_id: ids.userId != null ? String(ids.userId) : undefined,
    payload,
  };
}
