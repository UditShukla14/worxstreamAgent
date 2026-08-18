/**
 * Normalize a Worxstream webhook POST (or a delivery-list row) into a
 * governance pipeline event. Production traffic is the direct POST body.
 */

import { normalizeEventType } from './pipelineConfig.js';

const ENVELOPE_KEYS = new Set([
  'event',
  'event_type',
  'eventType',
  'event_id',
  'eventId',
  'event_code',
  'eventCode',
  'timestamp',
  'occurredAt',
  'occurred_at',
  'company_id',
  'companyId',
  'user_id',
  'userId',
  'payload',
  'data',
  'object',
  'object_type',
  'objectType',
  'object_id',
  'objectId',
  'deliveryId',
  'delivery_id',
  'payloadVersion',
  'payload_version',
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

function firstPresent(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

/**
 * @param {object} body  Direct webhook POST, or a Control Tower delivery row.
 * @param {{ companyId?: string, userId?: string, eventType?: string, eventId?: string }} [ids]
 */
export function eventFromWorxstreamWebhook(body, ids = {}) {
  const row = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const wrapped = asObject(row.requestPayload) || asObject(row.request_payload);
  const envelope = wrapped || row;
  const nestedCandidate = asObject(envelope.payload) || asObject(envelope.data);
  const nested = isNonEmptyObject(nestedCandidate) ? nestedCandidate : null;
  const catalogObject = asObject(envelope.object) || asObject(row.object) || {};

  const payload = nested ? { ...nested } : {};
  if (!nested) copyNonEnvelopeFields(envelope, payload);

  const eventType = normalizeEventType(
    firstPresent(
      envelope.event_type,
      envelope.eventType,
      envelope.event,
      envelope.event_code,
      envelope.eventCode,
      row.eventCode,
      row.event_code,
      row.event,
      ids.eventType,
      ids.event_type,
    ) || '',
  );

  const objectType = firstPresent(
    envelope.object_type,
    envelope.objectType,
    catalogObject.type,
    row.objectType,
    row.object_type,
    eventType.split('.')[0],
  );
  const objectId = firstPresent(
    envelope.object_id,
    envelope.objectId,
    catalogObject.id,
    row.objectId,
    row.object_id,
  );
  const idKey = objectIdKey(objectType);
  if (idKey && objectId != null && payload[idKey] == null) {
    payload[idKey] = objectId;
  }
  if (payload.customNumber != null && payload.custom_number == null) {
    payload.custom_number = payload.customNumber;
  }

  const eventId = String(
    firstPresent(
      envelope.event_id,
      envelope.eventId,
      envelope.deliveryId,
      envelope.delivery_id,
      row.deliveryId,
      row.delivery_id,
      ids.eventId,
      ids.deliveryId,
    ) || '',
  ).trim();

  const companyId = firstPresent(
    envelope.company_id,
    envelope.companyId,
    row.companyId,
    row.company_id,
    nested?.company_id,
    nested?.companyId,
    ids.companyId,
  );
  const userId = firstPresent(
    envelope.user_id,
    envelope.userId,
    row.userId,
    row.user_id,
    nested?.createdByUserId,
    nested?.updatedByUserId,
    nested?.created_by_user_id,
    nested?.updated_by_user_id,
    ids.userId,
  );

  return {
    event_type: eventType,
    event_id: eventId,
    timestamp: firstPresent(
      envelope.timestamp,
      envelope.occurredAt,
      envelope.occurred_at,
      row.sentAt,
      row.sent_at,
      row.createdAt,
      row.created_at,
      nested?.updatedAt,
    ) || new Date().toISOString(),
    company_id: companyId != null && String(companyId).trim() ? String(companyId).trim() : undefined,
    user_id: userId != null && String(userId).trim() ? String(userId).trim() : undefined,
    payload,
  };
}

/** @deprecated Use eventFromWorxstreamWebhook — kept for existing tests. */
export function eventFromWorxstreamDelivery(delivery, ids) {
  return eventFromWorxstreamWebhook(delivery, ids);
}
