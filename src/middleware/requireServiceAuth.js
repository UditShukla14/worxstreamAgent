/**
 * Service-to-service auth for /api/internal/*: a shared secret in `x-service-key` (or a Bearer token), compared in constant time.
 * Not for browsers or customers.
 */
import { timingSafeEqual, createHash } from 'crypto';
import { config } from '../config/index.js';

const digest = (v) => createHash('sha256').update(String(v)).digest();

export function requireServiceAuth(req, res, next) {
  const expected = config.apps?.serviceKey;
  if (!expected) {
    return res.status(503).json({ success: false, error: 'APP_SERVICE_KEY is not configured on the agent server.' });
  }
  const header = req.headers['x-service-key'];
  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const provided = (typeof header === 'string' && header.trim()) || bearer;
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
    return res.status(401).json({ success: false, error: 'Invalid or missing service key.' });
  }
  next();
}
