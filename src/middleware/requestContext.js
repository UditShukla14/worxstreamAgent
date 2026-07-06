/**
 * Bind per-request Worxstream tenant context (AsyncLocalStorage) for agent/tool routes.
 */

import {
  enterRequestContext,
  requestContextFromReq,
} from '../request/requestContext.js';

const CONTEXT_PATH_PREFIXES = [
  '/api/agents',
  '/api/tools',
  '/api/price-comparison',
  '/api/webhooks',
];

function shouldApplyContext(req) {
  const path = req.path || '';
  return CONTEXT_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Express middleware: run downstream handlers inside ALS.
 * Must be mounted AFTER express.json() so the parsed body is available.
 */
export function requestContextMiddleware(req, res, next) {
  if (!shouldApplyContext(req)) {
    return next();
  }
  enterRequestContext(requestContextFromReq(req), () => next());
}
