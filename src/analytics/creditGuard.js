/**
 * Keeps a company from spending past its Nova credit, call by call.
 *
 * Why: the credit check used to run before a chat and, inside it, after each model reply. A reply's price is only known
 * once it has been written, so the reply that crossed the limit was charged in full (a company with $1.00 ended at
 * -$0.01, and a long conversation can overshoot by much more). Two chats at once could also both pass the check.
 *
 * Now, for every chat turn:
 *   1. beginCreditTurn HOLDS part of the company's remaining credit (atomically, see reserveCredit). Chats running at
 *      the same time can only use what is not held.
 *   2. Before EVERY model call (plan, agent, formatter, summary) the call is bounded: its worst possible price (the input
 *      it will read plus the longest answer it may write) must fit what is left of the hold. If the answer limit
 *      (`max_tokens`) is too big it is lowered to fit; if not even a short answer fits, the call is refused.
 *   3. After each call the real cost is subtracted from the hold; the hold is released when the turn ends.
 * The company is billed the real usage exactly as before, so the wallet ends within a fraction of a cent of zero.
 */

import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { getRequestContext, setRequestContext } from '../request/requestContext.js';
import { estimateContextSize } from '../utils/tokenCounter.js';
import { resolveModelRatesDetailed } from './modelPricing.js';
import { computeEventCost } from './costing.js';
import { CREDIT_FLOOR_USD, computeRemainingUsd, getWallet, releaseCredit, reserveCredit, resolveMarkupRate } from './novaWallet.js';

const MICROS = 1_000_000;
/** A turn needs at least this much free credit (billable) to start. */
export const MIN_TURN_BILLABLE_USD = 0.01;
/** Below this the model could not write a useful answer, so the call is refused instead of cut to nothing. */
export const MIN_OUTPUT_TOKENS = 256;
/** The input estimate is a heuristic (about 4 characters per token); leave room for it being low. */
const INPUT_ESTIMATE_SAFETY = 1.15;
/**
 * Part of the hold that is never planned for, so an estimate that is still too low (first call of a turn, unusual text)
 * cannot take the company below zero. At most this share of the LAST turn's budget stays unspent.
 */
export const BUDGET_SAFETY_MARGIN = 0.03;

export class CreditExhaustedError extends Error {
  /** @param {'exhausted'|'busy'|'budget'} reason */
  constructor(reason = 'exhausted') {
    super(
      reason === 'busy'
        ? 'Your Nova credit is being used by other requests right now. Try again in a moment.'
        : 'Your Nova credit has run out. Add credit to continue.',
    );
    this.name = 'CreditExhaustedError';
    this.code = 'NOVA_CREDIT_EXHAUSTED';
    this.status = reason === 'busy' ? 429 : 402;
    this.reason = reason;
  }
}

/**
 * @typedef {object} CreditBudget
 * @property {string} companyId
 * @property {string} holdId
 * @property {number} providerBudgetUsd   what Anthropic may charge us during this turn (hold ÷ (1 + markup))
 * @property {number} spentProviderUsd    what the turn's calls have cost so far (Anthropic's price)
 * @property {number} inputScale          real input tokens ÷ estimated, the highest seen this turn (starts at 1): later estimates are scaled by it
 * @property {number} lastEstimatedInput  the estimate for the call in flight, to compare with its real size
 * @property {Promise<unknown>[]} pending usage records still being written
 */

/**
 * Hold credit for a turn. Returns null when the company has no wallet limit (nothing to enforce).
 * @param {string} companyId
 * @returns {Promise<CreditBudget|null>}
 * @throws {CreditExhaustedError} nothing free to hold ('exhausted' = empty, 'busy' = held by other running requests)
 */
export async function beginCreditTurn(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  const doc = await getWallet(id);
  if (!doc || !doc.limits_enabled) return null;
  const remaining = computeRemainingUsd(doc);
  if (remaining == null) return null;
  if (remaining < CREDIT_FLOOR_USD) throw new CreditExhaustedError('exhausted');

  const markup = await resolveMarkupRate(id);
  const perTurnProviderCap = Number(config.billing?.maxTurnCostUsd) || 0;
  // Hold what one turn may spend (the per-turn cap, billable), never more than the company has.
  const desiredBillableUsd = perTurnProviderCap > 0 ? Math.min(perTurnProviderCap * (1 + markup), remaining) : remaining;
  const holdId = randomUUID();
  const granted = await reserveCredit(id, {
    holdId,
    desiredMicros: Math.round(desiredBillableUsd * MICROS),
    minMicros: Math.round(MIN_TURN_BILLABLE_USD * MICROS),
  });
  if (!granted) throw new CreditExhaustedError('busy');
  return {
    companyId: id,
    holdId,
    providerBudgetUsd: (granted.grantedMicros / MICROS / (1 + markup)) * (1 - BUDGET_SAFETY_MARGIN),
    spentProviderUsd: 0,
    inputScale: 1,
    lastEstimatedInput: 0,
    pending: [],
  };
}

/** End of the turn: wait for its usage to be written to the wallet, then give the hold back. */
export async function endCreditTurn(budget) {
  if (!budget) return;
  try {
    await Promise.allSettled(budget.pending);
  } finally {
    await releaseCredit(budget.companyId, budget.holdId).catch(() => {});
  }
}

/** The running turn's budget (set by runWithCreditBudget), or null when credit is not enforced. */
export function getCreditBudget() {
  return getRequestContext()?.creditBudget ?? null;
}

/**
 * Run `fn` (the turn) with its credit budget in force, and always give the hold back afterwards.
 * @template T
 * @param {CreditBudget|null} budget
 * @param {() => Promise<T>} fn
 */
export async function runWithCreditBudget(budget, fn) {
  if (!budget) return fn();
  setRequestContext({ creditBudget: budget });
  try {
    return await fn();
  } finally {
    setRequestContext({ creditBudget: null });
    await endCreditTurn(budget);
  }
}

/**
 * The most this call could cost (Anthropic's price): everything it reads, priced as if all of it were written to the
 * cache (the dearest way), plus the longest answer it may write.
 * @returns {{ inputTokens: number, inputCostUsd: number, outputPerTokenUsd: number }}
 */
export function priceBoundsFor(params, scale = 1) {
  const rawEstimate = estimateContextSize(params.system, params.messages, params.tools);
  const inputTokens = Math.ceil(rawEstimate * INPUT_ESTIMATE_SAFETY * Math.max(1, scale));
  const { rates } = resolveModelRatesDetailed(params.model, { inputTokens });
  const dearestInputPerM = Math.max(rates.inputPerMillion, rates.cacheWritePerMillion || 0);
  return {
    inputTokens,
    rawEstimate,
    inputCostUsd: (inputTokens * dearestInputPerM) / MICROS,
    outputPerTokenUsd: rates.outputPerMillion / MICROS,
  };
}

/**
 * Fit a model call into what is left of the turn's budget: lower `max_tokens` so the worst case stays inside it.
 * @param {CreditBudget} budget
 * @param {object} params Messages API parameters
 * @returns {object} parameters to send (the same object when nothing needs to change)
 * @throws {CreditExhaustedError} when not even a short answer fits
 */
export function fitCallToBudget(budget, params) {
  const left = budget.providerBudgetUsd - budget.spentProviderUsd;
  const { inputCostUsd, outputPerTokenUsd, rawEstimate } = priceBoundsFor(params, budget.inputScale);
  budget.lastEstimatedInput = rawEstimate;
  const affordable = outputPerTokenUsd > 0 ? Math.floor((left - inputCostUsd) / outputPerTokenUsd) : Infinity;
  if (!(affordable >= MIN_OUTPUT_TOKENS)) throw new CreditExhaustedError('budget');

  const wanted = Number(params.max_tokens) || affordable;
  if (wanted <= affordable) return params;
  const fitted = { ...params, max_tokens: affordable };
  // A fixed thinking budget must stay below max_tokens; if it no longer does, answer without extended thinking.
  const thinkingBudget = params.thinking?.budget_tokens;
  if (thinkingBudget && thinkingBudget >= affordable) delete fitted.thinking;
  return fitted;
}

/** Subtract a finished call's real cost (Anthropic's price) from the budget. */
export function noteCallCost(budget, { model, responseModel, usage }) {
  if (!budget || !usage) return;
  budget.spentProviderUsd += computeEventCost({ model, responseModel, usage, markupRate: 0 }).providerCostUsd;
  // Learn how far off the estimate was, so the next call in this turn is bounded with the real ratio.
  const realInput = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  if (budget.lastEstimatedInput > 0 && realInput > 0) budget.inputScale = Math.max(budget.inputScale || 1, realInput / budget.lastEstimatedInput / INPUT_ESTIMATE_SAFETY);
}
