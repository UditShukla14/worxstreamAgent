/**
 * Require Worxstream credentials on agent routes (UI login or per-request headers).
 */

import {
  hasCompleteWorxstreamContext,
  resolveAgentCredentials,
  resolveConversationTenantIds,
} from '../utils/worxstreamCredentials.js';
import { setRequestContext } from '../request/requestContext.js';

const PUBLIC_AGENT_GET = new Set(['/', '']);

/**
 * Agent list (GET /api/agents) is public metadata; everything else needs login context.
 * @param {import('express').Request} req
 */
function isPublicAgentRoute(req) {
  if (req.method !== 'GET') return false;
  const subPath = (req.path || '/').replace(/\/+$/, '') || '/';
  return PUBLIC_AGENT_GET.has(subPath);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireWorxstreamAuth(req, res, next) {
  if (isPublicAgentRoute(req)) {
    return next();
  }

  const ctx = resolveAgentCredentials(req);
  if (!hasCompleteWorxstreamContext(ctx)) {
    return res.status(401).json({
      success: false,
      error:
        'Authentication required. Log in via POST /api/auth/session, or send companyId, userId, and apiToken (Authorization: Bearer, X-Worxstream-Token, or body fields).',
    });
  }

  // Keep MCP token from env/request, but bind ALS company/user to the conversation
  // tenant (request/session) so list/stream never inherit DEFAULT_* from env mode.
  const conversationTenant = resolveConversationTenantIds(req);
  setRequestContext({
    apiToken: ctx.apiToken,
    companyId: conversationTenant.companyId || ctx.companyId,
    userId: conversationTenant.userId || ctx.userId,
  });
  next();
}
