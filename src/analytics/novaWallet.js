/**
 * Company Nova wallet — status, grants, spend, and pre-turn enforcement.
 *
 * Money is stored as INTEGER micro-USD (1 USD = 1_000_000):
 *   free_allowance_micros, purchased_credit_micros, spent_micros   ← authoritative
 *   free_allowance_usd,    purchased_credit_usd,    spent_usd      ← derived mirrors for dashboards/legacy readers
 * Every write is a single atomic update-pipeline that changes the micros and recomputes the USD
 * mirror from them, so the two can never drift and concurrent debits never lose an update.
 * Amounts are billable (customer-facing) dollars: the markup is applied when the usage event is
 * recorded (see costing.js), and the wallet is debited the billable amount.
 */

import CompanyNovaWallet from './models/CompanyNovaWallet.js';
import { sanitizeModelTiers } from './taskModels.js';
import LlmUsageEvent from './models/LlmUsageEvent.js';
import { config } from '../config/index.js';
import { clampMarkup, usdToMicros, microsToUsd } from './costing.js';

export const NOVA_CREDIT_EXHAUSTED = 'NOVA_CREDIT_EXHAUSTED';

const MICROS = 1_000_000;

/** Aggregation expression: integer micros for a wallet field, tolerating legacy docs without micros. */
const microsExpr = (name) => ({
  $ifNull: [
    `$${name}_micros`,
    { $round: [{ $multiply: [{ $ifNull: [`$${name}_usd`, 0] }, MICROS] }, 0] },
  ],
});

/** Read a wallet field in micros from a (lean) doc, falling back to legacy USD. */
export function walletMicros(doc, name) {
  if (!doc) return 0;
  const m = doc[`${name}_micros`];
  if (Number.isFinite(m)) return Math.max(0, Math.round(m));
  return Math.max(0, usdToMicros(doc[`${name}_usd`]));
}

/**
 * @param {object|null|undefined} doc
 * @returns {number|null} remaining billable USD (null when there is no wallet)
 */
export function computeRemainingUsd(doc) {
  if (!doc) return null;
  const remaining = walletMicros(doc, 'free_allowance')
    + walletMicros(doc, 'purchased_credit')
    - walletMicros(doc, 'spent');
  return microsToUsd(remaining);
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
 * Customer-safe wallet view (never includes the markup).
 * @param {object|null} doc
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
  return {
    exists: true,
    enforced: Boolean(doc.limits_enabled),
    company_id: String(doc.company_id),
    free_allowance_usd: microsToUsd(walletMicros(doc, 'free_allowance')),
    purchased_credit_usd: microsToUsd(walletMicros(doc, 'purchased_credit')),
    spent_usd: microsToUsd(walletMicros(doc, 'spent')),
    remaining_usd: computeRemainingUsd(doc),
    model_tiers: modelTiersToApi(doc),
    notes: String(doc.notes || ''),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

/** @param {string} companyId */
export async function getWallet(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  return CompanyNovaWallet.findOne({ company_id: id }).lean();
}

/** Admin-only wallet view: adds markup override, effective markup and the display name. */
export async function getWalletStatus(companyId) {
  const doc = await getWallet(companyId);
  return {
    ...walletToApi(doc),
    display_name: doc?.display_name || '',
    seats: doc?.seats ?? null,
    markup_rate: doc?.markup_rate ?? null,
    effective_markup_rate: clampMarkup(doc?.markup_rate ?? config.billing?.markupRate ?? 0),
  };
}

const markupCache = new Map(); // companyId -> { rate, expires }
const MARKUP_TTL_MS = 60_000;

/** Markup in effect for a company: wallet override, else NOVA_MARKUP_RATE. Cached 60 s. */
export async function resolveMarkupRate(companyId) {
  const id = String(companyId || '').trim();
  const fallback = clampMarkup(config.billing?.markupRate ?? 0);
  if (!id) return fallback;
  const hit = markupCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.rate;
  let rate = fallback;
  try {
    const doc = await CompanyNovaWallet.findOne({ company_id: id }, { markup_rate: 1 }).lean();
    if (doc && doc.markup_rate != null) rate = clampMarkup(doc.markup_rate);
  } catch {
    /* DB hiccup: fall back to the default rate rather than dropping the event */
  }
  markupCache.set(id, { rate, expires: Date.now() + MARKUP_TTL_MS });
  return rate;
}

/**
 * One-time (idempotent) migration: give every legacy wallet integer micros fields.
 * Safe to run at every boot.
 */
export async function migrateWalletMicros() {
  const res = await CompanyNovaWallet.collection.updateMany(
    { $or: [{ spent_micros: { $exists: false } }, { free_allowance_micros: { $exists: false } }, { purchased_credit_micros: { $exists: false } }] },
    [{
      $set: {
        free_allowance_micros: microsExpr('free_allowance'),
        purchased_credit_micros: microsExpr('purchased_credit'),
        spent_micros: microsExpr('spent'),
      },
    }],
  );
  if (res.modifiedCount > 0) console.log(`💰 Migrated ${res.modifiedCount} wallet(s) to integer micro-USD`);
  return res.modifiedCount;
}

/**
 * Create or update free allowance / company model tiers / markup override / display name.
 * Creates the wallet when free_allowance_usd is set (starts enforcement).
 * @param {string} companyId
 * @param {{ free_allowance_usd?: number, notes?: string, model_tiers?: object, markup_rate?: number|null, display_name?: string }} body
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
    update.free_allowance_micros = usdToMicros(free);
    update.free_allowance_usd = microsToUsd(update.free_allowance_micros);
    update.limits_enabled = true;
  }
  if (body.notes !== undefined) update.notes = String(body.notes || '');
  if (body.display_name !== undefined) update.display_name = String(body.display_name || '').slice(0, 200);
  if (body.seats !== undefined) {
    if (body.seats === null || body.seats === '') {
      update.seats = null;
    } else {
      const n = Number(body.seats);
      if (!Number.isInteger(n) || n < 0) throw new Error('seats must be a non-negative whole number or null');
      update.seats = n;
    }
  }
  if (body.model_tiers !== undefined) update.model_tiers = sanitizeModelTiers(body.model_tiers);
  if (body.markup_rate !== undefined) {
    if (body.markup_rate === null) {
      update.markup_rate = null;
    } else {
      const m = Number(body.markup_rate);
      if (!Number.isFinite(m) || m < 0 || m > 5) {
        throw new Error('markup_rate must be between 0 and 5 (0.2 = +20%) or null');
      }
      update.markup_rate = m;
    }
    markupCache.delete(id);
  }
  if (
    !hasAllowance && body.model_tiers === undefined && body.notes === undefined
    && body.markup_rate === undefined && body.display_name === undefined && body.seats === undefined
  ) {
    throw new Error('Provide free_allowance_usd, model_tiers, notes, display_name, seats and/or markup_rate');
  }

  const doc = await CompanyNovaWallet.findOneAndUpdate(
    { company_id: id },
    {
      $set: update,
      $setOnInsert: {
        company_id: id,
        purchased_credit_usd: 0,
        purchased_credit_micros: 0,
        spent_usd: 0,
        spent_micros: 0,
        ...(hasAllowance ? {} : { free_allowance_usd: 0, free_allowance_micros: 0 }),
        ...(hasAllowance ? {} : { limits_enabled: false }),
      },
    },
    { upsert: true, new: true },
  ).lean();
  return walletToApi(doc);
}

/**
 * Grant purchased credits (ops top-up or payment webhook). Integer-exact, atomic.
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
  const addMicros = usdToMicros(amount);
  const now = new Date();
  const noteParts = [
    String(body.reason || '').trim() && `grant: ${String(body.reason).trim()}`,
    String(body.payment_ref || '').trim() && `payment_ref: ${String(body.payment_ref).trim()}`,
    body.notes != null && String(body.notes).trim(),
  ].filter(Boolean);
  const noteLine = noteParts.length ? `${now.toISOString()} ${noteParts.join(' | ')}` : '';

  const newPurchased = { $add: [microsExpr('purchased_credit'), addMicros] };
  const doc = await CompanyNovaWallet.collection.findOneAndUpdate(
    { company_id: id },
    [{
      $set: {
        company_id: id,
        purchased_credit_micros: newPurchased,
        purchased_credit_usd: { $divide: [newPurchased, MICROS] },
        free_allowance_micros: microsExpr('free_allowance'),
        free_allowance_usd: { $divide: [microsExpr('free_allowance'), MICROS] },
        spent_micros: microsExpr('spent'),
        spent_usd: { $divide: [microsExpr('spent'), MICROS] },
        limits_enabled: true,
        updated_at: now,
        ...(noteLine
          ? { notes: { $substrCP: [{ $concat: [{ $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n'] }, ''] }, noteLine] }, 0, 4000] } }
          : {}),
        model_tiers: { $ifNull: ['$model_tiers', {}] },
      },
    }],
    { upsert: true, returnDocument: 'after' },
  );
  return walletToApi(doc?.value ?? doc);
}

/**
 * Atomically debit spend (billable USD → integer micros). No-op without a wallet (= unlimited).
 * One pipeline update keeps micros authoritative and the USD mirror derived.
 * @param {string} companyId
 * @param {number} costUsd billable amount
 */
export async function incrementWalletSpent(companyId, costUsd) {
  const id = String(companyId || '').trim();
  const micros = usdToMicros(costUsd);
  if (!id || !Number.isFinite(micros) || micros <= 0) return null;
  const spent = { $add: [microsExpr('spent'), micros] };
  const res = await CompanyNovaWallet.collection.findOneAndUpdate(
    { company_id: id },
    [{
      $set: {
        spent_micros: spent,
        spent_usd: { $divide: [spent, MICROS] },
        free_allowance_micros: microsExpr('free_allowance'),
        purchased_credit_micros: microsExpr('purchased_credit'),
        updated_at: new Date(),
      },
    }],
    { returnDocument: 'after' },
  );
  return res?.value ?? res ?? null;
}

/**
 * Pre-turn gate. No wallet doc → allow (unlimited).
 * @param {string} companyId
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

/**
 * Ledger vs wallet (integer micros). The ledger is the source of truth;
 * `apply: true` rewrites the wallet's spent to the ledger total.
 * Legacy events (before billable_micros) count at their provider cost.
 * @param {string} companyId
 * @param {{ apply?: boolean }} [opts]
 */
export async function reconcileWalletFromLedger(companyId, { apply = false } = {}) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('companyId is required');
  const [agg] = await LlmUsageEvent.aggregate([
    { $match: { company_id: id, unattributed: { $ne: true } } },
    {
      $group: {
        _id: null,
        events: { $sum: 1 },
        billable_micros: {
          $sum: { $ifNull: ['$billable_micros', { $round: [{ $multiply: ['$cost_usd', MICROS] }, 0] }] },
        },
        provider_micros: {
          $sum: { $ifNull: ['$provider_cost_micros', { $round: [{ $multiply: ['$cost_usd', MICROS] }, 0] }] },
        },
        unapplied: { $sum: { $cond: [{ $eq: ['$wallet_applied', false] }, 1, 0] } },
        estimated: { $sum: { $cond: ['$cost_estimated', 1, 0] } },
      },
    },
  ]);
  const wallet = await getWallet(id);
  const ledgerMicros = Math.round(agg?.billable_micros || 0);
  const walletMicrosSpent = walletMicros(wallet, 'spent');
  const result = {
    company_id: id,
    events: agg?.events || 0,
    ledger_billable_usd: microsToUsd(ledgerMicros),
    ledger_provider_cost_usd: microsToUsd(Math.round(agg?.provider_micros || 0)),
    wallet_spent_usd: microsToUsd(walletMicrosSpent),
    drift_micros: walletMicrosSpent - ledgerMicros,
    drift_usd: microsToUsd(walletMicrosSpent - ledgerMicros),
    events_pending_wallet_debit: agg?.unapplied || 0,
    events_with_estimated_cost: agg?.estimated || 0,
    applied: false,
  };
  if (apply && wallet) {
    await CompanyNovaWallet.collection.updateOne(
      { company_id: id },
      { $set: { spent_micros: ledgerMicros, spent_usd: ledgerMicros / MICROS, updated_at: new Date() } },
    );
    result.applied = true;
  }
  return result;
}

/**
 * All wallets (admin). `status`: exhausted | low (<20% left) | ok | unlimited
 */
export async function listWallets() {
  const docs = await CompanyNovaWallet.find({}).lean();
  return docs.map((d) => {
    const total = walletMicros(d, 'free_allowance') + walletMicros(d, 'purchased_credit');
    const spent = walletMicros(d, 'spent');
    const remaining = total - spent;
    const pctLeft = total > 0 ? remaining / total : null;
    let status = 'unlimited';
    if (d.limits_enabled) status = remaining <= 0 ? 'exhausted' : (pctLeft != null && pctLeft < 0.2 ? 'low' : 'ok');
    return {
      company_id: String(d.company_id),
      display_name: d.display_name || '',
      seats: d.seats ?? null,
      enforced: Boolean(d.limits_enabled),
      free_allowance_usd: microsToUsd(walletMicros(d, 'free_allowance')),
      purchased_credit_usd: microsToUsd(walletMicros(d, 'purchased_credit')),
      spent_usd: microsToUsd(spent),
      remaining_usd: microsToUsd(remaining),
      pct_left: pctLeft,
      markup_rate: d.markup_rate ?? null,
      status,
      updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
    };
  });
}
