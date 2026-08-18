/**
 * Normalize a Worxstream webhook POST (or a delivery-list row) into a
 * governance pipeline event. Production traffic is the direct POST body.
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
  'object_type',
  'objectType',
  'object_id',
  'objectId',
  'deliveryId',
  'delivery_id',
  'requestPayload',
  'request_payload',
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

function copyNonEnvelopeFields(source, target) {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    if (target[key] == null) target[key] = value;
  }
}

/**
 * @param {object} body  Direct webhook POST, or a Control Tower delivery row.
 * @param {{ companyId?: string, userId?: string }} [ids]
 */
export function eventFromWorxstreamWebhook(body, ids = {}) {
  const row = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const wrapped = asObject(row.requestPayload) || asObject(row.request_payload);
  const envelope = wrapped || row;
  const nestedCandidate = asObject(envelope.payload) || asObject(envelope.data);
  const nested = isNonEmptyObject(nestedCandidate) ? nestedCandidate : null;

  const payload = nested ? { ...nested } : {};
  if (!nested) copyNonEnvelopeFields(envelope, payload);

  const eventType = normalizeEventType(
    envelope.event_type
      || envelope.eventType
      || envelope.event_code
      || envelope.eventCode
      || row.eventCode
      || row.event_code
      || '',
  );

  const objectType = envelope.object_type
    || envelope.objectType
    || row.objectType
    || row.object_type
    || eventType.split('.')[0];
  const objectId = envelope.object_id ?? envelope.objectId ?? row.objectId ?? row.object_id;
  const idKey = objectIdKey(objectType);
  if (idKey && objectId != null && payload[idKey] == null) {
    payload[idKey] = objectId;
  }

  const eventId = String(
    envelope.event_id
      || envelope.eventId
      || row.deliveryId
      || row.delivery_id
      || '',
  ).trim();

  const companyId = envelope.company_id
    ?? envelope.companyId
    ?? row.companyId
    ?? row.company_id
    ?? ids.companyId;
  const userId = envelope.user_id
    ?? envelope.userId
    ?? row.userId
    ?? row.user_id
    ?? ids.userId;

  return {
    event_type: eventType,
    event_id: eventId,
    timestamp: envelope.timestamp
      || row.sentAt
      || row.sent_at
      || row.createdAt
      || row.created_at
      || new Date().toISOString(),
    company_id: companyId != null && String(companyId).trim() ? String(companyId).trim() : undefined,
    user_id: userId != null && String(userId).trim() ? String(userId).trim() : undefined,
    payload,
  };
}

/** @deprecated Use eventFromWorxstreamWebhook — kept for existing tests. */
export function eventFromWorxstreamDelivery(delivery, ids) {
  return eventFromWorxstreamWebhook(delivery, ids);
}
