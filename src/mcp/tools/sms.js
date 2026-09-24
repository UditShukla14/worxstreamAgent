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
  resolveDefaultSmsFrom,
  sendTelnyxMessage,
} from '../../services/telnyxClient.js';

/** In-memory fallback when Redis is unavailable (dev / single-process). */
const memoryDrafts = new Map();
/** companyId:userId → latest draft_id (same process as drafts). */
const memoryLatestByTenant = new Map();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_DRAFT_IDS = new Set([
  'draft_id',
  'draftid',
  'null',
  'undefined',
  'none',
  'n/a',
  '',
]);

/** Appended to every outbound SMS draft (compliance / carrier best practice). */
export const SMS_OPT_OUT_FOOTER = 'Type STOP to opt-out from further receiving any updates';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function draftTtlSeconds() {
  return config.telnyx?.draftTtlSeconds ?? 600;
}

/**
 * Ensure the standard STOP footer is on the message once (case-insensitive).
 * @param {string} text
 * @returns {{ text: string, footer_appended: boolean }}
 */
export function withSmsOptOutFooter(text) {
  const body = String(text || '').trim();
  if (!body) return { text: body, footer_appended: false };
  const lower = body.toLowerCase();
  // Already has STOP opt-out language — do not duplicate.
  if (
    lower.includes('type stop to opt-out')
    || lower.includes('type stop to opt out')
    || /\bstop\b/.test(lower) && /opt[-\s]?out/.test(lower)
  ) {
    return { text: body, footer_appended: false };
  }
  return {
    text: `${body}\n\n${SMS_OPT_OUT_FOOTER}`,
    footer_appended: true,
  };
}

function draftKey(companyId, userId, draftId) {
  return `ws:sms-draft:${companyId}:${userId}:${draftId}`;
}

function latestDraftKey(companyId, userId) {
  return `ws:sms-latest:${companyId}:${userId}`;
}

function tenantMemKey(companyId, userId) {
  return `${companyId}:${userId}`;
}

function isValidDraftId(id) {
  const s = String(id || '').trim();
  if (!s || PLACEHOLDER_DRAFT_IDS.has(s.toLowerCase())) return false;
  return UUID_RE.test(s);
}

function pruneMemoryDrafts() {
  const now = Date.now();
  for (const [id, row] of memoryDrafts) {
    if (row.expiresAt && row.expiresAt < now) memoryDrafts.delete(id);
  }
}

async function setLatestDraftId(companyId, userId, draftId) {
  const ttlSec = draftTtlSeconds() > 0 ? draftTtlSeconds() : 600;
  memoryLatestByTenant.set(tenantMemKey(companyId, userId), {
    draftId,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  await redisSet(latestDraftKey(companyId, userId), draftId, { ex: ttlSec });
}

async function getLatestDraftId(companyId, userId) {
  const raw = await redisGet(latestDraftKey(companyId, userId));
  if (raw && isValidDraftId(raw)) return String(raw).trim();
  const mem = memoryLatestByTenant.get(tenantMemKey(companyId, userId));
  if (!mem) return null;
  if (mem.expiresAt && mem.expiresAt < Date.now()) {
    memoryLatestByTenant.delete(tenantMemKey(companyId, userId));
    return null;
  }
  return isValidDraftId(mem.draftId) ? mem.draftId : null;
}

async function clearLatestDraftId(companyId, userId, onlyIfDraftId = null) {
  if (onlyIfDraftId) {
    const current = await getLatestDraftId(companyId, userId);
    if (current && current !== onlyIfDraftId) return;
  }
  await redisDel(latestDraftKey(companyId, userId));
  memoryLatestByTenant.delete(tenantMemKey(companyId, userId));
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
  const ttlSec = ttl > 0 ? ttl : 600;
  // Always keep a process-local copy so a Redis blip between draft and send
  // does not drop the draft (seen as silent "no error" when send_sms hangs/retries).
  pruneMemoryDrafts();
  memoryDrafts.set(draftId, {
    ...payload,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  await redisSet(key, JSON.stringify(payload), { ex: ttlSec });
  await setLatestDraftId(companyId, userId, draftId);
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
  await clearLatestDraftId(companyId, userId, draftId);
}

export function registerSmsTools() {
  registerTool(
    'draft_sms',
    {
      title: 'Draft SMS',
      description:
        'Create an SMS draft for review. ALWAYS call this before send_sms. '
        + 'Show the returned to/from/text AND the exact draft_id UUID to yourself for the next turn. '
        + 'Wait for explicit confirmation before calling send_sms. Does not send anything.',
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
      const { text: textNorm, footer_appended: footerAppended } = withSmsOptOutFooter(text);
      // US → DID; international → alpha when profile+alpha are set.
      const fromNorm = String(from || resolveDefaultSmsFrom(toNorm, cfg)).trim();

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
        opt_out_footer_appended: footerAppended,
      });

      return asText({
        success: true,
        status: 'draft',
        message:
          'Draft ready. Show To, From, and Body to the user. '
          + (footerAppended
            ? `Standard opt-out line was appended: "${SMS_OPT_OUT_FOOTER}". `
            : '')
          + 'Only call send_sms({ draft_id }) after they explicitly confirm.',
        draft_id: draft.draft_id,
        to: draft.to,
        from: draft.from,
        text: draft.text,
        media_urls: draft.media_urls,
        char_count: draft.char_count,
        segments_estimate: draft.segments_estimate,
        opt_out_footer_appended: footerAppended,
        expires_in_seconds: draftTtlSeconds(),
      });
    },
  );

  registerTool(
    'send_sms',
    {
      title: 'Send SMS',
      description:
        'Send a previously drafted SMS via Telnyx. Pass the exact draft_id UUID from draft_sms '
        + '(never the literal string "draft_id"). If omitted after a recent draft, the latest pending draft is used. '
        + 'ONLY call after the user explicitly confirms in chat (e.g. "confirm" / "send it"). '
        + 'Do not call in the same turn as draft_sms unless the user message is already a confirm. '
        + 'Confirmation is agent-judged (not a UI write gate).',
      inputSchema: {
        draft_id: z.string().optional().describe(
          'Exact UUID from draft_sms result (e.g. 38c62c68-…). Never invent or use the placeholder "draft_id".',
        ),
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
      let id = String(draft_id || '').trim();
      let usedLatestFallback = false;

      if (!isValidDraftId(id)) {
        const latest = await getLatestDraftId(companyId, userId);
        if (latest) {
          console.warn('📱 send_sms: invalid/missing draft_id — using latest pending draft', {
            provided: id || null,
            latest,
          });
          id = latest;
          usedLatestFallback = true;
        }
      }

      if (!isValidDraftId(id)) {
        return asText({
          success: false,
          error:
            'draft_id must be the exact UUID returned by draft_sms (not the placeholder "draft_id"). '
            + 'Call draft_sms again, then send_sms with that UUID after the user confirms.',
        });
      }

      const draft = await loadDraft(companyId, userId, id);
      if (!draft) {
        console.error('📱 send_sms: draft missing', { draft_id: id, companyId, userId });
        return asText({
          success: false,
          error: 'Draft not found or expired. Call draft_sms again and re-confirm with the user.',
        });
      }

      console.log('📱 send_sms: sending', {
        draft_id: id,
        to: draft.to,
        from: draft.from,
        used_latest_fallback: usedLatestFallback,
      });

      const result = await sendTelnyxMessage({
        to: draft.to,
        text: draft.text,
        from: draft.from,
        messagingProfileId: draft.messaging_profile_id,
        mediaUrls: draft.media_urls,
      });

      if (result.success) {
        await clearDraft(companyId, userId, id);
      } else {
        console.error('📱 send_sms failed:', {
          draft_id: id,
          to: draft.to,
          from: draft.from,
          error: result.error,
          telnyx_error_code: result.telnyx_error_code || null,
          status: result.status || null,
        });
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
