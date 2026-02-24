/**
 * In-memory Worxstream session store.
 * Frontend sends userId, companyId, apiToken on login; backend uses them until logout.
 */

/** @type {{ userId: string, companyId: string, apiToken: string } | null } */
let currentSession = null;

/**
 * Set the active Worxstream session (called after frontend login).
 * @param {{ userId: string|number, companyId: string|number, apiToken: string }} credentials
 * @returns {boolean} true if set successfully
 */
export function setSession({ userId, companyId, apiToken }) {
  if (userId == null || companyId == null || !apiToken || typeof apiToken !== 'string') {
    return false;
  }
  const u = String(userId).trim();
  const c = String(companyId).trim();
  const t = apiToken.trim();
  if (!u || !c || !t) return false;
  currentSession = { userId: u, companyId: c, apiToken: t };
  return true;
}

/**
 * Clear the active session (called on frontend logout).
 */
export function clearSession() {
  currentSession = null;
}

/**
 * Get current session credentials (no token in logs; use only for internal API calls).
 * @returns {{ userId: string, companyId: string, apiToken: string } | null}
 */
export function getSession() {
  return currentSession;
}

/**
 * Whether an active session exists (safe to expose in API response).
 */
export function hasSession() {
  return currentSession !== null;
}
