/**
 * Telnyx Messaging REST client (server-only).
 * Used by MCP SMS tools — never expose TELNYX_API_KEY to the browser.
 *
 * Sender routing (Telnyx docs):
 * - US / Canada / Puerto Rico (+1 NANP): purchased long code / toll-free only.
 *   Alphanumeric sender IDs are NOT supported (error 40301 / UnsupportedDestination).
 * - International: prefer alphanumeric sender + messaging_profile_id.
 *   See https://developers.telnyx.com/docs/messaging/messages/alphanumeric-sender-id
 *   and https://developers.telnyx.com/docs/messaging/messages/international-sms-compliance
 */

import { config } from '../config/index.js';

const TELNYX_API = 'https://api.telnyx.com/v2';

/** Basic E.164: + and 8–15 digits. */
export function isE164(phone) {
  return /^\+[1-9]\d{7,14}$/.test(String(phone || '').trim());
}

/**
 * NANP destinations (+1 + 10 digits): US, Canada, Puerto Rico.
 * Telnyx: alphanumeric sender IDs cannot send here — use long code / TF / short code.
 */
export function isNanpDestination(phone) {
  return /^\+1\d{10}$/.test(String(phone || '').trim());
}

/** @deprecated Use isNanpDestination — kept for call sites. */
export function isUsDestination(phone) {
  return isNanpDestination(phone);
}

export function getTelnyxConfig() {
  const apiKey = (config.telnyx?.apiKey || '').trim();
  const fromNumber = (config.telnyx?.fromNumber || '').trim();
  const messagingProfileId = (config.telnyx?.messagingProfileId || '').trim();
  const usMessagingProfileId = (config.telnyx?.usMessagingProfileId || '').trim();
  const alphaSender = (config.telnyx?.alphaSender || '').trim();
  return {
    apiKey,
    fromNumber: fromNumber || '',
    messagingProfileId: messagingProfileId || '',
    usMessagingProfileId: usMessagingProfileId || '',
    alphaSender: alphaSender || '',
    configured: Boolean(apiKey && (fromNumber || alphaSender)),
  };
}

function isAlphaSender(from) {
  const s = String(from || '').trim();
  return Boolean(s) && !s.startsWith('+');
}

/**
 * Country-aware From + messaging profile (Telnyx international compliance pattern).
 * @returns {{ from: string, messagingProfileId: string|null, path: 'nanp_long_code'|'intl_alpha'|'intl_long_code', error?: string }}
 */
export function resolveSmsRoute(to, cfg = getTelnyxConfig(), preferredFrom = '') {
  const preferred = String(preferredFrom || '').trim();

  if (isNanpDestination(to)) {
    // Always purchased number for +1 — never alpha (Telnyx UnsupportedDestination / 40301).
    let from = preferred;
    if (!from || isAlphaSender(from)) from = cfg.fromNumber || '';
    if (!from) {
      return {
        from: '',
        messagingProfileId: null,
        path: 'nanp_long_code',
        error:
          'US/Canada/Puerto Rico require TELNYX_FROM_NUMBER (purchased long code). '
          + 'Alphanumeric sender IDs are not supported for +1 destinations.',
      };
    }
    if (isAlphaSender(from)) {
      return {
        from: '',
        messagingProfileId: null,
        path: 'nanp_long_code',
        error: 'NANP destination cannot use alphanumeric from.',
      };
    }
    // Prefer dedicated US profile when set; else omit profile and rely on number assignment.
    const profile = cfg.usMessagingProfileId || null;
    return {
      from,
      messagingProfileId: profile,
      path: 'nanp_long_code',
    };
  }

  // International: alphanumeric + messaging profile when configured.
  if (cfg.alphaSender && cfg.messagingProfileId) {
    const from = (preferred && isAlphaSender(preferred)) ? preferred : cfg.alphaSender;
    return {
      from,
      messagingProfileId: cfg.messagingProfileId,
      path: 'intl_alpha',
    };
  }

  const from = preferred || cfg.fromNumber || cfg.alphaSender || '';
  return {
    from,
    messagingProfileId: cfg.messagingProfileId || null,
    path: isAlphaSender(from) ? 'intl_alpha' : 'intl_long_code',
  };
}

/**
 * Pick default From for a destination (draft_sms).
 */
export function resolveDefaultSmsFrom(to, cfg = getTelnyxConfig()) {
  return resolveSmsRoute(to, cfg).from;
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

  const route = resolveSmsRoute(to, cfg, input.from);
  if (route.error || !route.from) {
    return {
      success: false,
      error: route.error || 'No sender configured. Set TELNYX_FROM_NUMBER and/or TELNYX_ALPHA_SENDER.',
      telnyx_error_code: isNanpDestination(to) ? '40301' : null,
      sender_path: route.path,
    };
  }

  const from = route.from;
  const body = {
    to,
    text,
    from,
  };

  // Profile: required for alpha; for NANP long code only when TELNYX_US_MESSAGING_PROFILE_ID is set
  // (avoids alpha-profile failover quirks that can mis-route +1 traffic).
  const profileId = String(
    input.messagingProfileId
    || route.messagingProfileId
    || (route.path === 'intl_alpha' || route.path === 'intl_long_code' ? cfg.messagingProfileId : '')
    || '',
  ).trim();
  if (profileId && route.path !== 'nanp_long_code') {
    body.messaging_profile_id = profileId;
  } else if (profileId && route.path === 'nanp_long_code' && cfg.usMessagingProfileId) {
    body.messaging_profile_id = cfg.usMessagingProfileId;
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
        path: route.path,
        http: res.status,
        code: code || null,
        detail,
      });
      return {
        success: false,
        error: detail,
        telnyx_error_code: code || null,
        status: res.status,
        sender_path: route.path,
        raw: json,
      };
    }

    const data = json?.data || json;
    console.log('📱 Telnyx send accepted:', {
      to,
      from,
      path: route.path,
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
      sender_path: route.path,
      data,
    };
  } catch (err) {
    console.error('📱 Telnyx send error:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to reach Telnyx API',
      sender_path: route.path,
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
