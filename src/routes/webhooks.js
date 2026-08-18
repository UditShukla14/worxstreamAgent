/**
 * Worxstream webhooks — event-driven governance pipeline.
 *
 * POST /api/webhooks/worxstream
 * Verifies optional shared secret, normalizes the catalog payload, dedupes
 * by event_id, responds 200, then runs the pipeline asynchronously.
 */

import { Router } from 'express';
import { acceptGovernanceEvent } from '../control/ingestEvent.js';
import { eventFromWorxstreamWebhook } from '../control/fromDelivery.js';

const router = Router();

function verifyWebhook(req) {
  const secret = (process.env.WORXSTREAM_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;
  const header = req.headers['x-worxstream-webhook-secret'];
  return header === secret;
}

/**
 * POST /api/webhooks/worxstream
 * Accepts the governance envelope or a Worxstream catalog POST
 * ({ event_code, object_id, company_id, payload }).
 */
router.post('/worxstream', async (req, res) => {
  try {
    if (!verifyWebhook(req)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    const event = eventFromWorxstreamWebhook(req.body || {});
    if (!event.event_type) {
      return res.status(400).json({ success: false, error: 'event_type or event_code is required' });
    }
    if (!event.company_id) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    const result = await acceptGovernanceEvent(event);
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('❌ Webhook error:', error);
    }
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
