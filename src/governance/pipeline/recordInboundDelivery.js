import WebhookDelivery from '../models/WebhookDelivery.js';

/**
 * Persist an inbound WorxStream webhook as a delivery row.
 * Does not clear deleted_at — a soft-deleted delivery stays omitted from lists.
 */
export async function recordInboundDelivery({
  companyId,
  deliveryId,
  eventId,
  eventCode,
  objectType,
  objectId,
  endpointUrl,
  status = 'sent',
  requestHeaders = null,
  requestPayload = null,
  responseStatus = 200,
  responseBodyExcerpt = null,
  errorMessage = null,
  sentAt = new Date(),
}) {
  const company_id = companyId != null ? String(companyId).trim() : '';
  const delivery_id = deliveryId != null ? String(deliveryId).trim() : '';
  if (!company_id || !delivery_id) return;

  await WebhookDelivery.updateOne(
    { company_id, delivery_id },
    {
      $set: {
        event_id: eventId != null ? String(eventId) : delivery_id,
        event_code: eventCode != null ? String(eventCode) : '',
        object_type: objectType != null ? String(objectType) : '',
        object_id: objectId != null ? String(objectId) : null,
        endpoint_url: endpointUrl != null ? String(endpointUrl) : '',
        status,
        attempts: 1,
        max_attempts: 1,
        request_headers: requestHeaders,
        request_payload: requestPayload,
        response_status: responseStatus,
        response_body_excerpt: responseBodyExcerpt,
        error_message: errorMessage,
        sent_at: sentAt,
      },
      $setOnInsert: { deleted_at: null },
    },
    { upsert: true },
  );
}
