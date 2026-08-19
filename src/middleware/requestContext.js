/**
 * Bind per-request Worxstream tenant context (AsyncLocalStorage) for agent/tool routes.
 */

import { enterRequestContext } from '../request/requestContext.js';
import { buildWorxstreamContext } from '../utils/worxstreamCredentials.js';

const AGENT_PATH_PREFIXES = ['/api/agents', '/api/price-comparison'];
const SERVER_PATH_PREFIXES = ['/api/tools', '/api/webhooks', '/api/control'];
const ENV_FALLBACK_PREFIXES = ['/api/tools', '/api/webhooks'];

function matchesPrefix(path, prefixes) {
  return prefixes.some((p) => path.startsWith(p));
}

function shouldApplyContext(req) {
  const path = req.path || '';
  return matchesPrefix(path, AGENT_PATH_PREFIXES) || matchesPrefix(path, SERVER_PATH_PREFIXES);
}

function allowEnvFallbackForPath(path) {
  return matchesPrefix(path, ENV_FALLBACK_PREFIXES);
}

/**
 * Express middleware: run downstream handlers inside ALS.
 * Must be mounted AFTER express.json() so the parsed body is available.
 */
export function requestContextMiddleware(req, res, next) {
  if (!shouldApplyContext(req)) {
    return next();
  }

  const ctx = buildWorxstreamContext(
    { req },
    { allowEnvFallback: allowEnvFallbackForPath(req.path || '') },
  );

  enterRequestContext(ctx, () => next());
}
