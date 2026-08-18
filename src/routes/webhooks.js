/**
 * Worxstream webhooks — event-driven governance pipeline.
 *
 * POST /api/webhooks/worxstream
 * Verifies secret, dedupes by event_id, responds 200, then runs the
 * master-agent pipeline asynchronously (Control Tower, not chat coworker).
 */

import { Router } from 'express';
import { acceptGovernanceEvent } from '../control/ingestEvent.js';

const router = Router();

function verifyWebhook(req) {
  const secret = (process.env.WORXSTREAM_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;
  const header = req.headers['x-worxstream-webhook-secret'];
  return header === secret;
}

/**
 * POST /api/webhooks/worxstream
 * Body: { event_type, event_id, timestamp, company_id, user_id, payload }
 */
router.post('/worxstream', async (req, res) => {
  try {
    if (!verifyWebhook(req)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    const result = await acceptGovernanceEvent(req.body || {});
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
