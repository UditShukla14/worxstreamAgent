/**
 * Require a WorxStream JWT on /api/control and bind company_id to that session.
 */

import { extractApiTokenFromRequest, setRequestContext } from '../request/requestContext.js';
import {
  bindCompanyId,
  bindUserId,
  resolveWorxstreamIdentity,
} from '../utils/worxstreamIdentity.js';

function companyIdFromReq(req) {
  const raw = req.query.company_id
    ?? req.query.companyId
    ?? req.body?.company_id
    ?? req.body?.companyId
    ?? req.headers['x-company-id'];
  return raw != null && String(raw).trim() ? String(raw).trim() : '';
}

function userIdFromReq(req) {
  const raw = req.query.user_id
    ?? req.query.userId
    ?? req.body?.user_id
    ?? req.body?.userId
    ?? req.headers['x-user-id'];
  return raw != null && String(raw).trim() ? String(raw).trim() : '';
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function requireControlAuth(req, res, next) {
  try {
    const apiToken = extractApiTokenFromRequest(req);
    if (!apiToken) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Send Authorization: Bearer with a WorxStream session token.',
      });
    }

    const claimedCompanyId = companyIdFromReq(req);
    if (!claimedCompanyId) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    const identity = await resolveWorxstreamIdentity(apiToken);
    if (!identity) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired WorxStream session.',
      });
    }

    const userId = bindUserId(userIdFromReq(req), identity);
    if (!userId) {
      return res.status(403).json({
        success: false,
        error: 'user_id does not match the authenticated session.',
      });
    }

    const companyId = bindCompanyId(claimedCompanyId, identity);
    if (!companyId) {
      return res.status(403).json({
        success: false,
        error: 'company_id is not on the authenticated session.',
      });
    }

    req.companyId = companyId;
    req.userId = userId;
    setRequestContext({ companyId, userId, apiToken });
    next();
  } catch (error) {
    next(error);
  }
}
