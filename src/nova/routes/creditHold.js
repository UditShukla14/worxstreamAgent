/**
 * Holds the company's credit for a request that is about to spend it (chat, route, multi, confirm, direct agent), and
 * gives it back when the response ends. Everything the request then asks the model is bounded by that hold
 * (see analytics/creditGuard.js), so a company cannot spend past its credit and two requests cannot both spend the
 * last dollar.
 *
 * An empty wallet is left to the existing gate in each route (same 402 answer as before); this only adds the "credit is
 * being used by another request right now" answer (429) and the hold itself.
 */

import { resolveConversationTenantIds } from '../../utils/worxstreamCredentials.js';
import { setRequestContext } from '../../request/requestContext.js';
import { beginCreditTurn, endCreditTurn, CreditExhaustedError } from '../../analytics/creditGuard.js';
import { getAgentKeys } from '../agents/agentDefinitions.js';

const SPENDING_PATHS = new Set(['/stream', '/route', '/multi', '/confirm']);

/** POST routes that call the model on the company's credit. */
export function spendsCredit(method, path) {
  if (method !== 'POST') return false;
  const clean = `/${String(path || '').split('/').filter(Boolean)[0] || ''}`;
  return SPENDING_PATHS.has(clean) || (String(path || '').split('/').filter(Boolean).length === 1 && getAgentKeys().includes(clean.slice(1)));
}

export async function creditHold(req, res, next) {
  if (!spendsCredit(req.method, req.path)) return next();
  const { companyId } = resolveConversationTenantIds(req);
  if (!companyId) return next(); // the route answers 400 itself

  let budget;
  try {
    budget = await beginCreditTurn(companyId);
  } catch (error) {
    if (!(error instanceof CreditExhaustedError)) return next(error);
    if (error.reason === 'busy') {
      return res.status(429).json({ success: false, code: 'NOVA_CREDIT_BUSY', error: error.message });
    }
    return next(); // empty: the route's own credit gate gives the usual answer
  }
  if (!budget) return next(); // no limit on this company

  setRequestContext({ creditBudget: budget });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    endCreditTurn(budget).catch(() => {});
  };
  res.on('finish', release);
  res.on('close', release);
  return next();
}
