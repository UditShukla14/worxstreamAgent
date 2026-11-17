/**
 * Free-form email through Worxstream's company public mail path (POST /api/public/company/email/{code}/send).
 * Shared by the send_email tool and by system alerts (e.g. Raven credit alerts). Needs WORXSTREAM_PUBLIC_EMAIL_CODE.
 */
import { config } from '../config/index.js';

/** Company public email code for free-form sends. */
export function resolvePublicEmailCode() {
  return String(process.env.WORXSTREAM_PUBLIC_EMAIL_CODE || process.env.PUBLIC_EMAIL_CODE || process.env.PUBLIC_LIVEKIT_CODE || '').trim();
}

/**
 * @param {{ mailTo: string[], mailCc?: string[], subject: string, body: string }} mail
 * @returns {Promise<{ success: boolean, error?: string, data?: any, message?: string }>}
 */
export async function sendPublicCompanyEmail({ mailTo, mailCc, subject, body }) {
  const code = resolvePublicEmailCode();
  if (!code) {
    return {
      success: false,
      error:
        'Free-form email needs WORXSTREAM_PUBLIC_EMAIL_CODE (or PUBLIC_EMAIL_CODE). '
        + 'This is the company public code used by POST /api/public/company/email/{code}/send.',
    };
  }
  const base = String(config.worxstream.baseUrl || '').replace(/\/+$/, '');
  if (!base) return { success: false, error: 'WORXSTREAM_BASE_URL is not configured' };
  const apiBase = base.endsWith('/api') ? base : `${base}/api`;
  const url = `${apiBase}/public/company/email/${encodeURIComponent(code)}/send`;
  const payload = { mail_to: mailTo, subject, body };
  if (Array.isArray(mailCc) && mailCc.length > 0) payload.mail_cc = mailCc;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok || parsed?.success === false) {
    return { success: false, error: parsed?.message || parsed?.error || `HTTP ${response.status}`, data: parsed?.data };
  }
  return { success: true, message: parsed?.message || 'Email queued successfully', data: parsed?.data ?? parsed };
}
