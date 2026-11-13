/**
 * Client for the mail backend (mail-agent-backend). Read-only use by the mail tools.
 * The signed-in user's Worxstream token is forwarded as the bearer token; the mail backend verifies it with
 * Worxstream and scopes every result to that user, so the agent can only see its own user's mailbox.
 */

import axios from 'axios';
import { config } from '../config/index.js';
import { resolveCallerToken } from '../utils/worxstreamCredentials.js';

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, getToken?: () => string, http?: { get: Function } }} [deps]
 */
export function createMailBackendClient(deps = {}) {
  const baseUrl = () => (deps.baseUrl ?? config.mail.baseUrl);
  // The caller's own token (their request, or the login session of that same user). Never the server's fallback token
  // or another user's session, which would make the mail backend answer for someone else's mailbox.
  const getToken = deps.getToken ?? (() => {
    const { token } = resolveCallerToken();
    if (!token) console.warn('📭 Mail: no token for this caller (the request carried none and no login session matches this user)');
    return token;
  });
  const http = deps.http ?? axios;
  const timeout = deps.timeoutMs ?? config.mail.timeoutMs;

  /** GET `endpoint` with query `params`; resolves `{ success: true, data }` or `{ success: false, error, status? }`. */
  async function get(endpoint, params = {}) {
    const base = baseUrl();
    if (!base) return { success: false, error: 'Mail is not configured for this workspace (MAIL_AGENT_API_URL).' };
    const token = getToken();
    if (!token) {
      return {
        success: false,
        status: 401,
        error: 'Mail needs your own signed-in session, and this request did not carry it. Reload the page and sign in again, then retry.',
      };
    }

    const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    try {
      const response = await http.get(`${base}${endpoint}`, {
        params: query,
        timeout,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = response.data;
      if (body && body.success === false) return { success: false, error: body.error || 'Mail request failed.' };
      return { success: true, data: body?.data ?? body };
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.error || error.message;
      if (status === 401) return { success: false, status, error: 'The mail service rejected the session. Sign in again.' };
      if (status === 503) return { success: false, status, error: 'The mail service is temporarily unavailable.' };
      return { success: false, status, error: message };
    }
  }

  return { get };
}

export const mailBackend = createMailBackendClient();
