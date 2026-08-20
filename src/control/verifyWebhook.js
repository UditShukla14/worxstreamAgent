/**
 * Verify POST /api/webhooks/worxstream.
 * Signing secret is optional: if WORXSTREAM_WEBHOOK_SECRET is unset, POSTs are accepted.
 * When the secret is set, accept the shared-secret header or HMAC-SHA256 over the raw body.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SECRET_HEADER = 'x-worxstream-webhook-secret';
export const WEBHOOK_SIGNATURE_HEADER = 'x-worxstream-signature';

export function webhookSecretFromEnv(env = process.env) {
  return String(env.WORXSTREAM_WEBHOOK_SECRET || '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  const len = Math.max(a.length, b.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  a.copy(padA);
  b.copy(padB);
  return timingSafeEqual(padA, padB) && a.length === b.length;
}

function signatureCandidates(header) {
  const raw = String(header || '').trim();
  if (!raw) return [];
  return raw.split(',').map((part) => {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    return eq === -1 ? trimmed : trimmed.slice(eq + 1).trim();
  }).filter(Boolean);
}

export function hmacSha256Hex(secret, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return createHmac('sha256', secret).update(body).digest('hex');
}

function signatureMatches(secret, rawBody, header) {
  if (rawBody == null) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  return signatureCandidates(header).some((candidate) => safeEqual(candidate, expected));
}

/**
 * @param {{
 *   secret?: string,
 *   secretHeader?: string,
 *   signatureHeader?: string,
 *   rawBody?: Buffer|string|null,
 * }} input
 */
export function verifyWebhookAuth({
  secret = webhookSecretFromEnv(),
  secretHeader = '',
  signatureHeader = '',
  rawBody = null,
} = {}) {
  const trimmedSecret = String(secret || '').trim();
  if (!trimmedSecret) {
    return { ok: true, mode: 'open' };
  }

  if (signatureMatches(trimmedSecret, rawBody, signatureHeader)) {
    return { ok: true, mode: 'hmac' };
  }

  if (secretHeader && safeEqual(secretHeader, trimmedSecret)) {
    return { ok: true, mode: 'secret' };
  }

  return { ok: false, status: 401, error: 'Invalid webhook signature' };
}

export function verifyWebhookRequest(req, env = process.env) {
  const secretHeader = req.headers?.[WEBHOOK_SECRET_HEADER];
  const signatureHeader = req.headers?.[WEBHOOK_SIGNATURE_HEADER];
  return verifyWebhookAuth({
    secret: webhookSecretFromEnv(env),
    secretHeader: Array.isArray(secretHeader) ? secretHeader[0] : secretHeader,
    signatureHeader: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
    rawBody: req.rawBody ?? null,
  });
}
