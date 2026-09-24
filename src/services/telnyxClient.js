/**
 * Telnyx Messaging REST client (server-only).
 * Used by MCP SMS tools — never expose TELNYX_API_KEY to the browser.
 */

import { config } from '../config/index.js';

const TELNYX_API = 'https://api.telnyx.com/v2';

/** Basic E.164: + and 8–15 digits. */
export function isE164(phone) {
  return /^\+[1-9]\d{7,14}$/.test(String(phone || '').trim());
}

/** US NANP (+1 + 10 digits). Alpha sender IDs are not supported for US destinations. */
export function isUsDestination(phone) {
  return /^\+1\d{10}$/.test(String(phone || '').trim());
}

export function getTelnyxConfig() {
  const apiKey = (config.telnyx?.apiKey || '').trim();
  const fromNumber = (config.telnyx?.fromNumber || '').trim();
  const messagingProfileId = (config.telnyx?.messagingProfileId || '').trim();
  const alphaSender = (config.telnyx?.alphaSender || '').trim();
  return {
    apiKey,
    fromNumber: fromNumber || '',
    messagingProfileId: messagingProfileId || '',
    alphaSender: alphaSender || '',
    configured: Boolean(apiKey && (fromNumber || alphaSender)),
  };
}

/**
 * Pick default From for a destination.
 * US (+1): long-code DID only — alpha gets Telnyx 40301.
 * International: prefer alpha when configured (needed for many markets / this profile).
 */
export function resolveDefaultSmsFrom(to, cfg = getTelnyxConfig()) {
  if (isUsDestination(to)) {
    return cfg.fromNumber || '';
  }
  if (cfg.messagingProfileId && cfg.alphaSender) return cfg.alphaSender;
  return cfg.fromNumber || cfg.alphaSender || '';
}

function isAlphaSender(from) {
  const s = String(from || '').trim();
  return Boolean(s) && !s.startsWith('+');
}

/**
 * Send an SMS (or alpha-sender SMS) via Telnyx Messages API.
 * @param {{ to: string, text: string, from?: string, messagingProfileId?: string, mediaUrls?: string[] }} input
 */
export async function sendTelnyxMessage(input) {
  const cfg = getTelnyxConfig();
  if (!cfg.apiKey) {
    return {
      success: false,
      error: 'TELNYX_API_KEY is not configured on the agent server.',
    };
  }

  const to = String(input.to || '').trim();
  const text = String(input.text || '');
  if (!isE164(to)) {
    return {
      success: false,
      error: 'Recipient must be E.164 (e.g. +15551234567).',
    };
  }
  if (!text.trim()) {
    return { success: false, error: 'Message text is required.' };
  }

  let from = String(input.from || resolveDefaultSmsFrom(to, cfg) || '').trim();
  // Never send alpha to US — rewrite even if a stale draft stored alpha.
  if (isUsDestination(to) && isAlphaSender(from)) {
    if (!cfg.fromNumber) {
      return {
        success: false,
        error: 'US destinations require TELNYX_FROM_NUMBER (long code). Alpha sender is not supported for +1.',
        telnyx_error_code: '40301',
      };
    }
    from = cfg.fromNumber;
  }
  if (!from) {
    return {
      success: false,
      error: 'No sender configured. Set TELNYX_FROM_NUMBER (or TELNYX_ALPHA_SENDER) or pass from.',
    };
  }

  const body = {
    to,
    text,
    from,
  };
  // Alpha traffic needs the messaging profile; DID can use it when set.
  const profileId = String(input.messagingProfileId || cfg.messagingProfileId || '').trim();
  if (profileId && (isAlphaSender(from) || cfg.messagingProfileId)) {
    body.messaging_profile_id = profileId;
  }

  const mediaUrls = Array.isArray(input.mediaUrls)
    ? input.mediaUrls.map((u) => String(u).trim()).filter(Boolean)
    : [];
  if (mediaUrls.length) body.media_urls = mediaUrls;

  try {
    const res = await fetch(`${TELNYX_API}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json?.errors?.[0]?.detail
        || json?.errors?.[0]?.title
        || json?.message
        || `Telnyx HTTP ${res.status}`;
      const code = json?.errors?.[0]?.code;
      console.error('📱 Telnyx send failed:', {
        to,
        from,
        http: res.status,
        code: code || null,
        detail,
      });
      return {
        success: false,
        error: detail,
        telnyx_error_code: code || null,
        status: res.status,
        raw: json,
      };
    }

    const data = json?.data || json;
    console.log('📱 Telnyx send accepted:', {
      to,
      from,
      id: data?.id || null,
      status: data?.to?.[0]?.status || data?.status || 'queued',
    });
    return {
      success: true,
      telnyx_message_id: data?.id || null,
      status: data?.to?.[0]?.status || data?.status || 'queued',
      to,
      from,
      text,
      data,
    };
  } catch (err) {
    console.error('📱 Telnyx send error:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to reach Telnyx API',
    };
  }
}

/**
 * Retrieve a message by Telnyx id (retained ~10 days).
 * @param {string} messageId
 */
export async function getTelnyxMessage(messageId) {
  const cfg = getTelnyxConfig();
  if (!cfg.apiKey) {
    return { success: false, error: 'TELNYX_API_KEY is not configured on the agent server.' };
  }
  const id = String(messageId || '').trim();
  if (!id) return { success: false, error: 'message_id is required.' };

  try {
    const res = await fetch(`${TELNYX_API}/messages/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: json?.errors?.[0]?.detail || `Telnyx HTTP ${res.status}`,
        status: res.status,
      };
    }
    return { success: true, data: json?.data || json };
  } catch (err) {
    return { success: false, error: err?.message || 'Failed to reach Telnyx API' };
  }
}
