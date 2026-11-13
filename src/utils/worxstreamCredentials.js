/**
 * Resolve Worxstream tenant credentials for agent and API calls.
 *
 * Company/user always come from the caller (ALS → request → session).
 * Never use DEFAULT_COMPANY_ID / DEFAULT_USER_ID — every production user
 * has their own company_id and user_id.
 *
 * WORXSTREAM_API_TOKEN remains an optional fallback for the API token only
 * (Scribe scheduled reports, unsigned server jobs) when the request has no JWT.
 *
 * Conversation Mongo scoping: resolveConversationTenantIds() — request → session → ALS.
 */

import { getRequestContext, requestContextFromReq } from '../request/requestContext.js';
import * as worxstreamSession from '../session/worxstreamSession.js';

/**
 * @typedef {{ companyId?: string, userId?: string, apiToken?: string }} WorxstreamCredentials
 */

/**
 * Optional server-side API token from .env (not a tenant identity).
 * @returns {string}
 */
export function readEnvApiToken() {
  return (process.env.WORXSTREAM_API_TOKEN || '').trim();
}

/**
 * @param {{ req?: import('express').Request }} [source]
 * @param {{ allowEnvTokenFallback?: boolean }} [options]
 * @returns {WorxstreamCredentials}
 */
export function buildWorxstreamContext(source = {}, { allowEnvTokenFallback = false } = {}) {
  const fromAls = getRequestContext() || {};
  const fromReq = source.req ? requestContextFromReq(source.req) : {};
  const session = worxstreamSession.getSession() || {};

  const companyId =
    fromAls.companyId ||
    fromReq.companyId ||
    session.companyId ||
    undefined;

  const userId =
    fromAls.userId ||
    fromReq.userId ||
    session.userId ||
    undefined;

  const apiToken =
    fromAls.apiToken ||
    fromReq.apiToken ||
    session.apiToken ||
    (allowEnvTokenFallback ? readEnvApiToken() : '') ||
    undefined;

  return {
    companyId: companyId ? String(companyId).trim() : undefined,
    userId: userId ? String(userId).trim() : undefined,
    apiToken: apiToken ? String(apiToken).trim() : undefined,
  };
}

/**
 * @param {WorxstreamCredentials} ctx
 * @returns {boolean}
 */
export function hasCompleteWorxstreamContext(ctx) {
  return Boolean(ctx.companyId && ctx.userId && ctx.apiToken);
}

/**
 * Credentials for agent routes — per-request / session tenant; token may fall back to env.
 * @param {import('express').Request} req
 * @returns {WorxstreamCredentials}
 */
export function resolveAgentCredentials(req) {
  return buildWorxstreamContext({ req }, { allowEnvTokenFallback: true });
}

/**
 * Mongo conversation / preferences tenancy from the caller only.
 * Prefers request (query/body/headers) → session → ALS.
 *
 * @param {import('express').Request} [req]
 * @returns {{ companyId?: string, userId?: string }}
 */
export function resolveConversationTenantIds(req) {
  const fromReq = req ? requestContextFromReq(req) : {};
  const session = worxstreamSession.getSession() || {};
  const fromAls = getRequestContext() || {};

  const companyId =
    fromReq.companyId ||
    session.companyId ||
    fromAls.companyId ||
    undefined;

  const userId =
    fromReq.userId ||
    session.userId ||
    fromAls.userId ||
    undefined;

  return {
    companyId: companyId ? String(companyId).trim() : undefined,
    userId: userId ? String(userId).trim() : undefined,
  };
}

/**
 * The token to use for per-user services (mail): the person who is asking, and only them.
 *  1. the token this request itself carried (Authorization / X-Worxstream-Token / body), else
 *  2. the shared login session's token, but ONLY when that session belongs to the same user (and company) as the
 *     request, so a chat from user A can never run with user B's session.
 * Never WORXSTREAM_API_TOKEN: that is a server identity, not the caller.
 * @returns {{ token: string, source: 'request' | 'session' | 'none' }}
 */
export function resolveCallerToken() {
  const als = getRequestContext() || {};
  if (als.userToken) return { token: als.userToken, source: 'request' };
  const session = worxstreamSession.getSession();
  const sameUser = session && als.userId && String(session.userId) === String(als.userId);
  const sameCompany = session && (!als.companyId || String(session.companyId) === String(als.companyId));
  if (sameUser && sameCompany && session.apiToken) return { token: session.apiToken, source: 'session' };
  return { token: '', source: 'none' };
}
