/**
 * Company Nova USD wallet — status, grants, spend, and pre-turn enforcement.
 */

import CompanyNovaWallet from './models/CompanyNovaWallet.js';
import { sanitizeModelTiers } from './taskModels.js';

export const NOVA_CREDIT_EXHAUSTED = 'NOVA_CREDIT_EXHAUSTED';

/**
 * @param {{ free_allowance_usd?: number, purchased_credit_usd?: number, spent_usd?: number }|null|undefined} doc
 */
export function computeRemainingUsd(doc) {
  if (!doc) return null;
  const free = Math.max(0, Number(doc.free_allowance_usd) || 0);
  const purchased = Math.max(0, Number(doc.purchased_credit_usd) || 0);
  const spent = Math.max(0, Number(doc.spent_usd) || 0);
  return free + purchased - spent;
}

function modelTiersToApi(doc) {
  const raw = doc?.model_tiers;
  if (!raw || typeof raw !== 'object') {
    return { daily: '', medium: '', hard: '', advanced: '' };
  }
  return {
    daily: String(raw.daily || ''),
    medium: String(raw.medium || ''),
    hard: String(raw.hard || ''),
    advanced: String(raw.advanced || ''),
  };
}

/**
 * @param {import('./models/CompanyNovaWallet.js').default|null} doc
 */
export function walletToApi(doc) {
  if (!doc) {
    return {
      exists: false,
      enforced: false,
      company_id: null,
      free_allowance_usd: 0,
      purchased_credit_usd: 0,
      spent_usd: 0,
      remaining_usd: null,
      model_tiers: { daily: '', medium: '', hard: '', advanced: '' },
      notes: '',
      updated_at: null,
    };
  }
  const enforced = Boolean(doc.limits_enabled);
  const remaining = computeRemainingUsd(doc);
  return {
    exists: true,
    enforced,
    company_id: String(doc.company_id),
    free_allowance_usd: Number(doc.free_allowance_usd) || 0,
    purchased_credit_usd: Number(doc.purchased_credit_usd) || 0,
    spent_usd: Number(doc.spent_usd) || 0,
    remaining_usd: remaining,
    model_tiers: modelTiersToApi(doc),
    notes: String(doc.notes || ''),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

/**
 * @param {string} companyId
 */
export async function getWallet(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  return CompanyNovaWallet.findOne({ company_id: id }).lean();
}

/**
 * @param {string} companyId
 */
export async function getWalletStatus(companyId) {
  const doc = await getWallet(companyId);
  return walletToApi(doc ? { ...doc, company_id: doc.company_id } : null);
}

/**
 * Create or update free allowance / company model tiers.
 * Creates the wallet when free_allowance_usd is set (starts enforcement).
 * model_tiers-only updates upsert without forcing a spend limit.
 * @param {string} companyId
 * @param {{ free_allowance_usd?: number, notes?: string, model_tiers?: object }} body
 */
export async function setWalletAllowance(companyId, body = {}) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('companyId is required');
  const now = new Date();
  const update = { updated_at: now };

  const hasAllowance = body.free_allowance_usd !== undefined && body.free_allowance_usd !== null;
  if (hasAllowance) {
    const free = Number(body.free_allowance_usd);
    if (!Number.isFinite(free) || free < 0) {
      throw new Error('free_allowance_usd must be a non-negative number');
    }
    update.free_allowance_usd = free;
    update.limits_enabled = true;
  }
  if (body.notes !== undefined) {
    update.notes = String(body.notes || '');
  }
  if (body.model_tiers !== undefined) {
    update.model_tiers = sanitizeModelTiers(body.model_tiers);
  }
  if (!hasAllowance && body.model_tiers === undefined && body.notes === undefined) {
    throw new Error('Provide free_allowance_usd and/or model_tiers');
  }

  const doc = await CompanyNovaWallet.findOneAndUpdate(
    { company_id: id },
    {
      $set: update,
      $setOnInsert: {
        company_id: id,
        purchased_credit_usd: 0,
        spent_usd: 0,
        limits_enabled: Boolean(hasAllowance),
      },
    },
    { upsert: true, new: true },
  );
  return walletToApi(doc);
}

/**
 * Grant purchased credits (ops top-up or Stripe webhook).
 * Creates wallet if missing (purchased-only still enforces once doc exists).
 * @param {string} companyId
 * @param {{ amount_usd: number, reason?: string, payment_ref?: string, notes?: string }} body
 */
export async function grantWalletCredits(companyId, body = {}) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('companyId is required');
  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount_usd must be a positive number');
  }
  const now = new Date();
  const reason = String(body.reason || '').trim();
  const paymentRef = String(body.payment_ref || '').trim();
  const noteParts = [
    reason && `grant: ${reason}`,
    paymentRef && `payment_ref: ${paymentRef}`,
    body.notes != null && String(body.notes).trim(),
  ].filter(Boolean);
  const noteLine = noteParts.length ? noteParts.join(' | ') : '';

  const existing = await CompanyNovaWallet.findOne({ company_id: id });
  const set = { updated_at: now };
  if (noteLine) {
    const prev = existing?.notes ? `${existing.notes}\n` : '';
    set.notes = `${prev}${now.toISOString()} ${noteLine}`.slice(0, 4000);
  }

  set.limits_enabled = true;
  const doc = await CompanyNovaWallet.findOneAndUpdate(
    { company_id: id },
    {
      $inc: { purchased_credit_usd: amount },
      $set: set,
      $setOnInsert: {
        company_id: id,
        free_allowance_usd: 0,
        spent_usd: 0,
        limits_enabled: true,
      },
    },
    { upsert: true, new: true },
  );
  return walletToApi(doc);
}

/**
 * Atomically add spent_usd when a wallet exists. No-op if unlimited (no doc).
 * @param {string} companyId
 * @param {number} costUsd
 */
export async function incrementWalletSpent(companyId, costUsd) {
  const id = String(companyId || '').trim();
  const cost = Number(costUsd);
  if (!id || !Number.isFinite(cost) || cost <= 0) return null;
  return CompanyNovaWallet.findOneAndUpdate(
    { company_id: id },
    {
      $inc: { spent_usd: cost },
      $set: { updated_at: new Date() },
    },
    { new: true },
  );
}

/**
 * Pre-turn gate. No wallet doc → allow (unlimited).
 * @param {string} companyId
 * @returns {Promise<{ ok: true, wallet: object } | { ok: false, status: number, body: object }>}
 */
export async function assertNovaCredits(companyId) {
  const id = String(companyId || '').trim();
  if (!id) {
    return { ok: true, wallet: walletToApi(null) };
  }
  const doc = await getWallet(id);
  if (!doc || !doc.limits_enabled) {
    return { ok: true, wallet: walletToApi(doc) };
  }
  const remaining = computeRemainingUsd(doc);
  const wallet = walletToApi(doc);
  if (remaining != null && remaining <= 0) {
    return {
      ok: false,
      status: 402,
      body: {
        success: false,
        code: NOVA_CREDIT_EXHAUSTED,
        remaining_usd: remaining,
        message: 'Nova credits exhausted. Purchase more credits to continue.',
        wallet,
      },
    };
  }
  return { ok: true, wallet };
}
