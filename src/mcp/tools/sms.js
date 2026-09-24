/**
 * SMS tools — Telnyx messaging for Nova (draft → user confirm → send).
 *
 * Flow:
 * 1. draft_sms — validate + store draft; Nova shows To/From/Body to the user
 * 2. User confirms in chat (and optionally UI write-confirm when COWORKER_CONFIRM_WRITES)
 * 3. send_sms({ draft_id }) — loads draft and calls Telnyx
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { registerTool } from '../server.js';
import { getWorxstreamContext, config } from '../../config/index.js';
import { redisDel, redisGet, redisSet } from '../../services/redisClient.js';
import {
  getTelnyxConfig,
  getTelnyxMessage,
  isE164,
  sendTelnyxMessage,
} from '../../services/telnyxClient.js';

/** In-memory fallback when Redis is unavailable (dev / single-process). */
const memoryDrafts = new Map();

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function draftTtlSeconds() {
  return config.telnyx?.draftTtlSeconds ?? 600;
}

function draftKey(companyId, userId, draftId) {
  return `ws:sms-draft:${companyId}:${userId}:${draftId}`;
}

function pruneMemoryDrafts() {
  const now = Date.now();
  for (const [id, row] of memoryDrafts) {
    if (row.expiresAt && row.expiresAt < now) memoryDrafts.delete(id);
  }
}

async function storeDraft(companyId, userId, draft) {
  const draftId = draft.draft_id || randomUUID();
  const ttl = draftTtlSeconds();
  const payload = {
    ...draft,
    draft_id: draftId,
    company_id: companyId,
    user_id: userId,
    created_at: Date.now(),
  };
  const key = draftKey(companyId, userId, draftId);
  const ok = await redisSet(key, JSON.stringify(payload), { ex: ttl > 0 ? ttl : 600 });
  if (!ok) {
    pruneMemoryDrafts();
    memoryDrafts.set(draftId, {
      ...payload,
      expiresAt: Date.now() + (ttl > 0 ? ttl : 600) * 1000,
    });
  }
  return payload;
}

async function loadDraft(companyId, userId, draftId) {
  const key = draftKey(companyId, userId, draftId);
  const raw = await redisGet(key);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  pruneMemoryDrafts();
  const mem = memoryDrafts.get(draftId);
  if (!mem) return null;
  if (String(mem.company_id) !== String(companyId) || String(mem.user_id) !== String(userId)) {
    return null;
  }
  return mem;
}

async function clearDraft(companyId, userId, draftId) {
  await redisDel(draftKey(companyId, userId, draftId));
  memoryDrafts.delete(draftId);
}

export function registerSmsTools() {
  registerTool(
    'draft_sms',
    {
      title: 'Draft SMS',
      description:
        'Create an SMS draft for review. ALWAYS call this before send_sms. '
        + 'Show the returned to/from/text to the user and wait for explicit confirmation before calling send_sms with draft_id. '
        + 'Does not send anything.',
      inputSchema: {
        to: z.string().describe('Recipient phone in E.164 (e.g. +15551234567)'),
        text: z.string().min(1).max(1600).describe('SMS body text'),
        from: z.string().optional().describe('Sender (E.164 or alpha). Defaults to TELNYX_FROM_NUMBER'),
        media_urls: z.array(z.string().url()).optional().describe('Optional public HTTPS media URLs (MMS)'),
      },
      capabilities: {
        domain: 'communications',
        entity: 'sms',
        action: 'other',
        safety: 'read',
      },
    },
    async ({ to, text, from, media_urls } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const cfg = getTelnyxConfig();
      const toNorm = String(to || '').trim();
      const textNorm = String(text || '').trim();
      const fromNorm = String(from || cfg.fromNumber || cfg.alphaSender || '').trim();

      if (!cfg.apiKey) {
        return asText({
          success: false,
          error: 'Telnyx is not configured (missing TELNYX_API_KEY on the agent).',
        });
      }
      if (!isE164(toNorm)) {
        return asText({
          success: false,
          error: 'to must be E.164 format, e.g. +15551234567 (no spaces).',
        });
      }
      if (!textNorm) {
        return asText({ success: false, error: 'text is required.' });
      }
      if (!fromNorm) {
        return asText({
          success: false,
          error: 'No sender available. Set TELNYX_FROM_NUMBER or pass from.',
        });
      }

      const draft = await storeDraft(companyId, userId, {
        to: toNorm,
        from: fromNorm,
        text: textNorm,
        media_urls: Array.isArray(media_urls) ? media_urls : [],
        messaging_profile_id: cfg.messagingProfileId || null,
        char_count: textNorm.length,
        segments_estimate: Math.max(1, Math.ceil(textNorm.length / 160)),
      });

      return asText({
        success: true,
        status: 'draft',
        message:
          'Draft ready. Show To, From, and Body to the user. '
          + 'Only call send_sms({ draft_id }) after they explicitly confirm.',
        draft_id: draft.draft_id,
        to: draft.to,
        from: draft.from,
        text: draft.text,
        media_urls: draft.media_urls,
        char_count: draft.char_count,
        segments_estimate: draft.segments_estimate,
        expires_in_seconds: draftTtlSeconds(),
      });
    },
  );

  registerTool(
    'send_sms',
    {
      title: 'Send SMS',
      description:
        'Send a previously drafted SMS via Telnyx. Requires draft_id from draft_sms. '
        + 'ONLY call after the user has explicitly confirmed the draft. '
        + 'This is a write action and may trigger a confirmation gate.',
      inputSchema: {
        draft_id: z.string().describe('draft_id returned by draft_sms'),
      },
      capabilities: {
        domain: 'communications',
        entity: 'sms',
        action: 'create',
        safety: 'write',
      },
    },
    async ({ draft_id } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const id = String(draft_id || '').trim();
      if (!id) {
        return asText({
          success: false,
          error: 'draft_id is required. Call draft_sms first, show the draft, then send after confirmation.',
        });
      }

      const draft = await loadDraft(companyId, userId, id);
      if (!draft) {
        return asText({
          success: false,
          error: 'Draft not found or expired. Call draft_sms again and re-confirm with the user.',
        });
      }

      const result = await sendTelnyxMessage({
        to: draft.to,
        text: draft.text,
        from: draft.from,
        messagingProfileId: draft.messaging_profile_id,
        mediaUrls: draft.media_urls,
      });

      if (result.success) {
        await clearDraft(companyId, userId, id);
      }

      return asText({
        ...result,
        draft_id: id,
        message: result.success
          ? 'SMS accepted by Telnyx.'
          : (result.error || 'Send failed'),
      });
    },
  );

  registerTool(
    'get_sms_status',
    {
      title: 'Get SMS Status',
      description: 'Retrieve delivery status for a Telnyx message id returned by send_sms.',
      inputSchema: {
        message_id: z.string().describe('Telnyx message id (telnyx_message_id from send_sms)'),
      },
      capabilities: {
        domain: 'communications',
        entity: 'sms',
        action: 'get',
        safety: 'read',
      },
    },
    async ({ message_id } = {}) => {
      const result = await getTelnyxMessage(message_id);
      return asText(result);
    },
  );
}
