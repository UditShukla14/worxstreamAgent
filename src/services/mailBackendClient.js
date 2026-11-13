/**
 * Client for the mail backend (mail-agent-backend). Read-only use by the mail tools.
 * The signed-in user's Worxstream token is forwarded as the bearer token; the mail backend verifies it with
 * Worxstream and scopes every result to that user, so the agent can only see its own user's mailbox.
 */

import axios from 'axios';
import { config, getWorxstreamApiToken } from '../config/index.js';

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, getToken?: () => string, http?: { get: Function } }} [deps]
 */
export function createMailBackendClient(deps = {}) {
  const baseUrl = () => (deps.baseUrl ?? config.mail.baseUrl);
  const getToken = deps.getToken ?? getWorxstreamApiToken;
  const http = deps.http ?? axios;
  const timeout = deps.timeoutMs ?? config.mail.timeoutMs;

  /** GET `endpoint` with query `params`; resolves `{ success: true, data }` or `{ success: false, error, status? }`. */
  async function get(endpoint, params = {}) {
    const base = baseUrl();
    if (!base) return { success: false, error: 'Mail is not configured for this workspace (MAIL_AGENT_API_URL).' };
    const token = getToken();
    if (!token) return { success: false, error: 'Not signed in.', status: 401 };

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
