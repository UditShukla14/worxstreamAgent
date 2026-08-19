/**
 * Resolve Worxstream tenant credentials for agent and API calls.
 *
 * Precedence (first non-empty wins):
 *   1. AsyncLocalStorage store (per-request middleware)
 *   2. Express request body, query, or headers
 *   3. In-memory session (POST /api/auth/session after UI login)
 *   4. Optional .env fallbacks (webhooks, scripts — not agent routes)
 */

import { getRequestContext, requestContextFromReq } from '../request/requestContext.js';
import * as worxstreamSession from '../session/worxstreamSession.js';

/**
 * @typedef {{ companyId?: string, userId?: string, apiToken?: string }} WorxstreamCredentials
 */

/**
 * @param {{ req?: import('express').Request }} [source]
 * @param {{ allowEnvFallback?: boolean }} [options]
 * @returns {WorxstreamCredentials}
 */
export function buildWorxstreamContext(source = {}, { allowEnvFallback = false } = {}) {
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
 * Credentials for agent routes (no .env fallback).
 * @param {import('express').Request} req
 * @returns {WorxstreamCredentials}
 */
export function resolveAgentCredentials(req) {
  return buildWorxstreamContext({ req }, { allowEnvFallback: false });
}
