/**
 * Platform-ops auth for /api/admin/* (token usage billing).
 */

import { config } from '../config/index.js';
import { timingSafeEqual, createHash } from 'crypto';

function keysEqual(a, b) {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdminAuth(req, res, next) {
  const expected = config.admin?.apiKey;
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: 'ADMIN_API_KEY is not configured on the agent server.',
    });
  }

  const headerKey = req.headers['x-admin-api-key'];
  const auth = req.headers.authorization;
  const bearer =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';
  const provided = (typeof headerKey === 'string' && headerKey.trim()) || bearer;

  if (!keysEqual(provided, expected)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing admin API key.',
    });
  }

  next();
}
