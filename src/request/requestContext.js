/**
 * Per-request Worxstream tenant context via AsyncLocalStorage.
 * Ensures concurrent stream requests use the correct company/user/token.
 */

import { AsyncLocalStorage } from 'async_hooks';

/** @typedef {{ companyId?: string, userId?: string, apiToken?: string }} RequestContextStore */

const storage = new AsyncLocalStorage();

/**
 * @returns {RequestContextStore | undefined}
 */
export function getRequestContext() {
  return storage.getStore();
}

/**
 * Merge fields into the current ALS store (no-op if not inside a request).
 * @param {Partial<RequestContextStore>} partial
 */
export function setRequestContext(partial) {
  const store = storage.getStore();
  if (!store || !partial || typeof partial !== 'object') return;
  if (partial.companyId != null) store.companyId = String(partial.companyId).trim();
  if (partial.userId != null) store.userId = String(partial.userId).trim();
  if (partial.apiToken != null) store.apiToken = String(partial.apiToken).trim();
}

function normalizeStore(ctx) {
  return {
    companyId: ctx.companyId != null ? String(ctx.companyId).trim() : undefined,
    userId: ctx.userId != null ? String(ctx.userId).trim() : undefined,
    apiToken: ctx.apiToken != null ? String(ctx.apiToken).trim() : undefined,
  };
}

/**
 * Run a sync callback inside ALS (Express middleware).
 * @param {RequestContextStore} ctx
 * @param {() => void} fn
 */
export function enterRequestContext(ctx, fn) {
  return storage.run(normalizeStore(ctx), fn);
}

/**
 * Run an async function with an isolated request context.
 * @param {RequestContextStore} ctx
 * @param {() => Promise<unknown>} fn
 */
export async function runWithRequestContext(ctx, fn) {
  return storage.run(normalizeStore(ctx), fn);
}

/**
 * Extract Bearer or custom token from request headers.
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
export function extractApiTokenFromRequest(req) {
  const custom = req.headers['x-worxstream-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
}

/**
 * Build initial context from Express request (body + headers).
 * @param {import('express').Request} req
 * @returns {RequestContextStore}
 */
export function requestContextFromReq(req) {
  const body = req.body || {};
  const companyId = body.companyId ?? body.company_id;
  const userId = body.userId ?? body.user_id;
  const apiToken = body.apiToken ?? body.api_token ?? extractApiTokenFromRequest(req);

  return {
    companyId: companyId != null ? String(companyId) : undefined,
    userId: userId != null ? String(userId) : undefined,
    apiToken: apiToken || undefined,
  };
}
