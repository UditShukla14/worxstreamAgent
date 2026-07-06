/**
 * Worxstream webhooks — event-driven coworker (Phase 6 foundation).
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runCoworkerTurn } from '../agents/coworkerPipeline.js';
import { getDefaultTenantIds } from '../config/index.js';

const router = Router();

function verifyWebhookSecret(req) {
  const secret = process.env.WORXSTREAM_WEBHOOK_SECRET || '';
  if (!secret) return true;
  const header = req.headers['x-worxstream-webhook-secret'];
  return header === secret;
}

/**
 * POST /api/webhooks/worxstream
 * Body: { event_type, company_id, user_id, payload }
 */
router.post('/worxstream', async (req, res) => {
  try {
    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    const { event_type, company_id, user_id, payload } = req.body || {};
    if (!event_type) {
      return res.status(400).json({
        success: false,
        error: 'event_type is required',
      });
    }

    const defaults = getDefaultTenantIds();
    const companyId = company_id != null ? String(company_id) : defaults.companyId;
    const userId = user_id != null ? String(user_id) : defaults.userId;

    const syntheticMessage = `[Webhook event: ${event_type}]\n${JSON.stringify(payload || {}, null, 2)}\n\nReview this event and take any appropriate Worxstream actions.`;

    const result = await runCoworkerTurn({
      message: syntheticMessage,
      company_id: companyId,
      user_id: userId,
      conversation_id: `webhook-${randomUUID()}`,
      options: {
        streamFormatter: false,
        skipClarification: true,
      },
    });

    res.json({
      success: true,
      event_type,
      conversation_id: result.conversation_id,
      response: result.response,
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
