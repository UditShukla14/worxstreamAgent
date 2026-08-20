/**
 * Worxstream webhooks — event-driven governance pipeline.
 *
 * POST /api/webhooks/worxstream
 * Verifies shared secret or HMAC, normalizes the catalog payload, dedupes
 * by event_id, responds 200, then runs the pipeline asynchronously.
 * Signing secret is optional; verification runs only when WORXSTREAM_WEBHOOK_SECRET is set.
 */

import { Router } from 'express';
import { acceptGovernanceEvent } from '../control/ingestEvent.js';
import { eventFromWorxstreamWebhook } from '../control/fromDelivery.js';
import { recordInboundDelivery } from '../control/recordInboundDelivery.js';
import { verifyWebhookRequest } from '../control/verifyWebhook.js';

const router = Router();

/**
 * POST /api/webhooks/worxstream
 * Accepts the governance envelope or a Worxstream catalog POST
 * ({ event, deliveryId, companyId, object, data } or event_code / payload).
 */
router.post('/worxstream', async (req, res) => {
  try {
    const verified = verifyWebhookRequest(req);
    if (!verified.ok) {
      return res.status(verified.status || 401).json({ success: false, error: verified.error });
    }

    const event = eventFromWorxstreamWebhook(req.body || {}, {
      eventType: req.headers['x-worxstream-event'],
      eventId: req.headers['x-worxstream-delivery-id'],
    });
    if (!event.event_type) {
      return res.status(400).json({ success: false, error: 'event, event_type, or event_code is required' });
    }
    if (!event.company_id) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    const endpointUrl = `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
    const requestHeaders = {
      ...(req.headers['x-worxstream-event'] ? { 'x-worxstream-event': String(req.headers['x-worxstream-event']) } : {}),
      ...(req.headers['x-worxstream-delivery-id']
        ? { 'x-worxstream-delivery-id': String(req.headers['x-worxstream-delivery-id']) }
        : {}),
      ...(req.headers['content-type'] ? { 'content-type': String(req.headers['content-type']) } : {}),
    };

    try {
      const result = await acceptGovernanceEvent(event);
      await recordInboundDelivery({
        companyId: event.company_id,
        deliveryId: result.event_id,
        eventId: result.event_id,
        eventCode: result.event_type,
        objectType: String(result.event_type || '').split('.')[0],
        endpointUrl,
        status: 'sent',
        requestHeaders: Object.keys(requestHeaders).length ? requestHeaders : null,
        requestPayload: event.payload,
        responseStatus: 200,
        responseBodyExcerpt: JSON.stringify({ success: true, ...result }).slice(0, 500),
        sentAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      const status = error.status || 500;
      await recordInboundDelivery({
        companyId: event.company_id,
        deliveryId: event.event_id || req.headers['x-worxstream-delivery-id'],
        eventId: event.event_id || req.headers['x-worxstream-delivery-id'],
        eventCode: event.event_type,
        objectType: String(event.event_type || '').split('.')[0],
        endpointUrl,
        status: 'failed',
        requestHeaders: Object.keys(requestHeaders).length ? requestHeaders : null,
        requestPayload: event.payload,
        responseStatus: status,
        errorMessage: error.message,
        sentAt: new Date(),
      }).catch(() => {});
      throw error;
    }
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('❌ Webhook error:', error);
    }
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
