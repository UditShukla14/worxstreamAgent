/**
 * Bind Control Tower callers to a WorxStream JWT via GET /api/user-info.
 * Never trust client-supplied company_id / user_id without this check.
 */

const CACHE_TTL_MS = 60_000;
const FAIL_TTL_MS = 5_000;

/** @type {Map<string, { identity: WorxstreamIdentity, expiresAt: number }>} */
const authCache = new Map();
/** @type {Map<string, { expiresAt: number }>} */
const failCache = new Map();
/** @type {Map<string, Promise<WorxstreamIdentity|null>>} */
const inFlight = new Map();

/**
 * @typedef {{ userId: string, companyIds: string[] }} WorxstreamIdentity
 */

export function worxstreamApiBaseUrl() {
  const raw = (process.env.WORXSTREAM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

function readId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function collectCompanyIds(companyRoles, user) {
  const ids = new Set();

  if (companyRoles && typeof companyRoles === 'object') {
    for (const [key, role] of Object.entries(companyRoles)) {
      const fromKey = readId(key);
      if (fromKey) ids.add(fromKey);
      if (role && typeof role === 'object') {
        const fromRole = readId(role.companyId ?? role.company_id);
        if (fromRole) ids.add(fromRole);
      }
    }
  }

  const relations = user?.userRelations;
  if (Array.isArray(relations)) {
    for (const relation of relations) {
      if (!relation || typeof relation !== 'object') continue;
      const id = readId(relation.companyId ?? relation.company_id);
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

/**
 * @param {unknown} body
 * @returns {WorxstreamIdentity|null}
 */
export function parseUserInfoPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const root = /** @type {Record<string, unknown>} */ (body);
  const nested = root.data && typeof root.data === 'object'
    ? /** @type {Record<string, unknown>} */ (root.data)
    : null;

  const userRaw = nested?.user ?? root.user;
  if (!userRaw || typeof userRaw !== 'object') return null;
  const user = /** @type {Record<string, unknown>} */ (userRaw);

  const userId = readId(user.id);
  if (!userId) return null;

  const companyRoles = nested?.companyRoles ?? root.companyRoles;
  return {
    userId,
    companyIds: collectCompanyIds(companyRoles, user),
  };
}

async function fetchIdentity(token) {
  const baseUrl = worxstreamApiBaseUrl();
  if (!baseUrl) return null;

  const response = await fetch(`${baseUrl}/user-info`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return null;
  const body = await response.json();
  return parseUserInfoPayload(body);
}

/**
 * @param {string} token
 * @returns {Promise<WorxstreamIdentity|null>}
 */
export async function resolveWorxstreamIdentity(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;

  const cached = authCache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  const failed = failCache.get(trimmed);
  if (failed && failed.expiresAt > Date.now()) return null;

  const pending = inFlight.get(trimmed);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      const identity = await fetchIdentity(trimmed);
      if (!identity) {
        authCache.delete(trimmed);
        failCache.set(trimmed, { expiresAt: Date.now() + FAIL_TTL_MS });
        return null;
      }
      failCache.delete(trimmed);
      authCache.set(trimmed, {
        identity,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return identity;
    } catch (error) {
      console.error('Control Tower identity lookup failed:', error);
      failCache.set(trimmed, { expiresAt: Date.now() + FAIL_TTL_MS });
      return null;
    } finally {
      inFlight.delete(trimmed);
    }
  })();

  inFlight.set(trimmed, lookup);
  return lookup;
}

/**
 * @param {string} claimedUserId
 * @param {WorxstreamIdentity} identity
 * @returns {string|null}
 */
export function bindUserId(claimedUserId, identity) {
  const claimed = String(claimedUserId || '').trim();
  if (claimed && claimed !== identity.userId) return null;
  return identity.userId;
}

/**
 * @param {string} claimedCompanyId
 * @param {WorxstreamIdentity} identity
 * @returns {string|null}
 */
export function bindCompanyId(claimedCompanyId, identity) {
  const claimed = String(claimedCompanyId || '').trim();
  if (!claimed) return null;
  if (identity.companyIds.length === 0) return claimed;
  return identity.companyIds.includes(claimed) ? claimed : null;
}

export function clearWorxstreamIdentityCache() {
  authCache.clear();
  failCache.clear();
  inFlight.clear();
}
