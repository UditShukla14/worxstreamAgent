/**
 * Per-tenant model selection for Nova task tiers:
 *   daily    — router / plan / summary / formatter / self-check
 *   medium   — specialist agent tool loops (incl. reports / shopify for now)
 *   hard     — reserved (not wired yet)
 *   advanced — reserved (not wired yet)
 *
 * Wallets (`company_nova_wallets`) live in agent Mongo.
 * Platform subscription / trial data lives in Laravel — not agent Mongo.
 */

import { config } from '../config/index.js';
import { getRequestContext } from '../request/requestContext.js';
import { findModelCatalogEntry, MODEL_CATALOG } from './modelPricing.js';
import UserPreferences from '../nova/models/UserPreferences.js';
import CompanyNovaWallet from './models/CompanyNovaWallet.js';

/** Full tier keys (prefs schema). Runtime currently only uses ACTIVE_TASK_TIERS. */
export const TASK_TIERS = Object.freeze(['daily', 'medium', 'hard', 'advanced']);

/** Tiers exposed in UI and used for routing today. */
export const ACTIVE_TASK_TIERS = Object.freeze(['daily', 'medium']);

/** @typedef {'daily'|'medium'|'hard'|'advanced'} TaskTier */

/** Sensible defaults aligned with current env (Haiku fast / Sonnet agent). */
export const DEFAULT_TASK_MODELS = Object.freeze({
  daily: config.anthropic.fastModel || 'claude-haiku-4-5',
  medium: config.anthropic.model || 'claude-sonnet-4-6',
  hard: 'claude-opus-4-6',
  advanced: 'claude-opus-4-1',
});

/**
 * @param {unknown} raw
 * @returns {Partial<Record<TaskTier, string>>}
 */
export function sanitizeModelTiers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  /** @type {Partial<Record<TaskTier, string>>} */
  const out = {};
  for (const tier of TASK_TIERS) {
    const id = String(/** @type {any} */ (raw)[tier] || '').trim();
    if (!id) continue;
    if (findModelCatalogEntry(id) || MODEL_CATALOG.some((m) => m.id === id)) {
      out[tier] = findModelCatalogEntry(id)?.id || id;
    }
  }
  return out;
}

/**
 * Resolve each tier: the company's model (set by Worxstream in the admin dashboard) ← a personal preference
 * (only where the company set nothing) ← the env default. Companies can no longer change models themselves, so
 * an old personal preference must never override what Worxstream chose for the company.
 * @param {Partial<Record<TaskTier, string>>} [company]
 * @param {Partial<Record<TaskTier, string>>} [user]
 */
export function resolveTaskModelMap(company = {}, user = {}) {
  return {
    daily: company.daily || user.daily || DEFAULT_TASK_MODELS.daily,
    medium: company.medium || user.medium || DEFAULT_TASK_MODELS.medium,
    hard: company.hard || user.hard || DEFAULT_TASK_MODELS.hard,
    advanced: company.advanced || user.advanced || DEFAULT_TASK_MODELS.advanced,
  };
}

/**
 * Load resolved tier→model map for a company/user.
 * @param {string} companyId
 * @param {string} [userId]
 */
export async function loadTaskModels(companyId, userId) {
  const cid = String(companyId || '').trim();
  const uid = String(userId || '').trim();
  let companyTiers = {};
  let userTiers = {};

  if (cid) {
    const wallet = await CompanyNovaWallet.findOne({ company_id: cid })
      .select('model_tiers')
      .lean();
    companyTiers = sanitizeModelTiers(wallet?.model_tiers);
  }
  if (cid && uid) {
    const prefs = await UserPreferences.findOne({ company_id: cid, user_id: uid })
      .select('preferences')
      .lean();
    userTiers = sanitizeModelTiers(prefs?.preferences?.model_tiers);
  }

  return resolveTaskModelMap(companyTiers, userTiers);
}

/**
 * Model id for a task tier from ALS (populated at turn start) or defaults.
 * @param {TaskTier} tier
 * @returns {string}
 */
export function getModelForTier(tier) {
  const key = TASK_TIERS.includes(tier) ? tier : 'medium';
  const ctx = getRequestContext();
  const fromCtx = ctx?.taskModels?.[key];
  if (fromCtx) return String(fromCtx);
  return DEFAULT_TASK_MODELS[key];
}

/**
 * Map agent / phase to a task tier.
 * @param {{ agentKey?: string, phase?: string, taskTier?: string }} [meta]
 * @returns {TaskTier}
 */
export function inferTaskTier(meta = {}) {
  // Explicit hard/advanced only when callers opt in later; ignore until wired.
  if (meta.taskTier === 'daily' || meta.taskTier === 'medium') {
    return meta.taskTier;
  }
  const phase = String(meta.phase || '').toLowerCase();
  if (
    ['router', 'nova_plan', 'formatter', 'summary', 'self_check', 'execution_plan', 'general_chat'].includes(phase)
  ) {
    return 'daily';
  }
  // reports / shopify / governance / specialists → medium until hard/advanced ship
  return 'medium';
}

/**
 * @param {{ agentKey?: string, phase?: string, taskTier?: string, model?: string }} [meta]
 */
export function resolveModelForMeta(meta = {}) {
  if (meta.model) return String(meta.model);
  return getModelForTier(inferTaskTier(meta));
}
