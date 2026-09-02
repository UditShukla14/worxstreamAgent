/**
 * Resolve Worxstream tenant credentials for agent and API calls.
 *
 * When WORXSTREAM_API_TOKEN, DEFAULT_COMPANY_ID, and DEFAULT_USER_ID are all set
 * in the agent .env, those values are used for every WorxStream API call (MCP tools,
 * Scribe reports, etc.) — session JWT, localStorage, and Mongo tenant fields are ignored.
 *
 * Otherwise precedence is:
 *   1. AsyncLocalStorage (per-request middleware)
 *   2. Express request body, query, or headers
 *   3. In-memory session (POST /api/auth/session)
 *   4. Optional .env fallbacks when allowEnvFallback is true
 */

import { getRequestContext, requestContextFromReq } from '../request/requestContext.js';
import * as worxstreamSession from '../session/worxstreamSession.js';

/**
 * @typedef {{ companyId?: string, userId?: string, apiToken?: string }} WorxstreamCredentials
 */

/**
 * Read WorxStream API credentials from agent .env only.
 * @returns {WorxstreamCredentials | null}
 */
export function readEnvWorxstreamCredentials() {
  const companyId = (process.env.DEFAULT_COMPANY_ID || '').trim();
  const userId = (process.env.DEFAULT_USER_ID || '').trim();
  const apiToken = (process.env.WORXSTREAM_API_TOKEN || '').trim();
  if (!companyId || !userId || !apiToken) return null;
  return { companyId, userId, apiToken };
}

/**
 * @returns {WorxstreamCredentials}
 */
export function requireEnvWorxstreamCredentials() {
  const creds = readEnvWorxstreamCredentials();
  if (!creds) {
    throw new Error(
      'Set WORXSTREAM_API_TOKEN, DEFAULT_COMPANY_ID, and DEFAULT_USER_ID in the agent .env file.',
    );
  }
  return creds;
}

/**
 * @param {{ req?: import('express').Request }} [source]
 * @param {{ allowEnvFallback?: boolean }} [options]
 * @returns {WorxstreamCredentials}
 */
export function buildWorxstreamContext(source = {}, { allowEnvFallback = false } = {}) {
  const fromEnv = readEnvWorxstreamCredentials();
  if (fromEnv) {
    return fromEnv;
  }

  const fromAls = getRequestContext() || {};
  const fromReq = source.req ? requestContextFromReq(source.req) : {};
  const session = worxstreamSession.getSession() || {};

  const envCompany = allowEnvFallback ? (process.env.DEFAULT_COMPANY_ID || '').trim() : '';
  const envUser = allowEnvFallback ? (process.env.DEFAULT_USER_ID || '').trim() : '';
  const envToken = allowEnvFallback ? (process.env.WORXSTREAM_API_TOKEN || '').trim() : '';

  const companyId =
    fromAls.companyId ||
    fromReq.companyId ||
    session.companyId ||
    envCompany ||
    undefined;

  const userId =
    fromAls.userId ||
    fromReq.userId ||
    session.userId ||
    envUser ||
    undefined;

  const apiToken =
    fromAls.apiToken ||
    fromReq.apiToken ||
    session.apiToken ||
    envToken ||
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
 * Credentials for agent routes. Env wins when all three vars are set; else request/session.
 * @param {import('express').Request} req
 * @returns {WorxstreamCredentials}
 */
export function resolveAgentCredentials(req) {
  return buildWorxstreamContext({ req }, { allowEnvFallback: true });
}
