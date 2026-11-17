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

import CompanyAppSubscription from '../apps/models/CompanyAppSubscription.js';
import CompanyNovaWallet from './models/CompanyNovaWallet.js';
import { sanitizeModelTiers } from './taskModels.js';
import LlmUsageEvent from './models/LlmUsageEvent.js';
import WalletTransaction from './models/WalletTransaction.js';
import { getNovaPlan, loadPlanContext } from './novaPlans.js';
import { quoteForPrice } from './novaPricing.js';
import { config } from '../config/index.js';
import { clampMarkup, usdToMicros, microsToUsd } from './costing.js';

export const NOVA_CREDIT_EXHAUSTED = 'NOVA_CREDIT_EXHAUSTED';

/** Below this many billable dollars no useful answer fits, so the credit counts as used up (cents left by the safety margin). */
export const CREDIT_FLOOR_USD = 0.02;

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

/** Low = still positive but under the configured share of everything granted, or under the dollar floor. */
export function isLowBalance({ enforced, remaining, granted }) {
  if (!enforced || remaining == null || remaining <= 0) return false;
  const ratio = Number(config.billing?.lowBalanceRatio ?? 0.1);
  const floor = Number(config.billing?.lowBalanceUsd ?? 2);
  return remaining <= floor || (granted > 0 && remaining / granted < ratio);
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
      exhausted: false,
      low_balance: false,
      plan_name: '',
      seats: null,
      model_tiers: { daily: '', medium: '', hard: '', advanced: '' },
      updated_at: null,
    };
  }
  const remaining = computeRemainingUsd(doc);
  const granted = microsToUsd(walletMicros(doc, 'free_allowance') + walletMicros(doc, 'purchased_credit'));
  const enforced = Boolean(doc.limits_enabled);
  return {
    exists: true,
    enforced,
    company_id: String(doc.company_id),
    free_allowance_usd: microsToUsd(walletMicros(doc, 'free_allowance')),
    purchased_credit_usd: microsToUsd(walletMicros(doc, 'purchased_credit')),
    spent_usd: microsToUsd(walletMicros(doc, 'spent')),
    remaining_usd: remaining,
    exhausted: enforced && remaining != null && remaining < CREDIT_FLOOR_USD,
    low_balance: isLowBalance({ enforced, remaining, granted }),
    plan_name: String(doc.plan_name || ''),
    seats: doc.seats ?? null,
    model_tiers: modelTiersToApi(doc),
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
    /** Staff notes (payment references, grant reasons). Never part of the customer view. */
    notes: String(doc?.notes || ''),
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
  if (body.plan_name !== undefined) update.plan_name = String(body.plan_name || '').trim().slice(0, 80);
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
    && body.plan_name === undefined
  ) {
    throw new Error('Provide free_allowance_usd, model_tiers, notes, display_name, plan_name, seats and/or markup_rate');
  }

  const before = hasAllowance ? await getWallet(id) : null;
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
  if (hasAllowance) {
    const delta = update.free_allowance_micros - walletMicros(before, 'free_allowance');
    if (delta !== 0) {
      await recordWalletTransaction(id, {
        type: 'allowance_set',
        amount_micros: delta,
        balance_after_micros: remainingMicros(doc),
        reason: `free allowance set to $${microsToUsd(update.free_allowance_micros)}`,
        actor: body.actor || 'admin',
      });
    }
  }
  return walletToApi(doc);
}

/**
 * Append a wallet history row. Never throws: the balance is already correct, the history is best-effort.
 * @param {string} companyId
 * @param {{ type: string, amount_micros: number, balance_after_micros?: number|null, reason?: string, payment_ref?: string, actor?: string }} tx
 */
export async function recordWalletTransaction(companyId, tx) {
  try {
    await WalletTransaction.create({
      company_id: String(companyId),
      type: tx.type,
      amount_micros: Math.round(tx.amount_micros),
      amount_usd: microsToUsd(Math.round(tx.amount_micros)),
      balance_after_micros: tx.balance_after_micros ?? null,
      plan_id: String(tx.plan_id || ''),
      plan_name: String(tx.plan_name || ''),
      paid_micros: tx.paid_micros ?? null,
      reason: String(tx.reason || '').slice(0, 500),
      payment_ref: String(tx.payment_ref || '').trim(),
      actor: tx.actor || 'system',
    });
  } catch (err) {
    if (err?.code === 11000) return; // same payment_ref already in the history
    console.error('wallet history write failed:', err?.message);
  }
}

const remainingMicros = (doc) =>
  walletMicros(doc, 'free_allowance') + walletMicros(doc, 'purchased_credit') - walletMicros(doc, 'spent');

/**
 * Grant purchased credits (payment webhook or ops top-up). Integer-exact, atomic and IDEMPOTENT per payment_ref:
 * a repeated payment_ref (webhook retry) changes nothing and returns `duplicate: true`.
 * @param {string} companyId
 * @param {{ amount_usd: number, reason?: string, payment_ref?: string, notes?: string, actor?: string }} body
 */
export async function grantWalletCredits(companyId, body = {}) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('companyId is required');
  // A purchase: the server decides the credit and the price paid, so the caller cannot choose a better deal.
  //  - plan_id: a Nova plan (its name becomes the company's plan)
  //  - custom_amount_usd: the "type your own amount" plan, within the allowed range
  // Both give the volume-discount credit for that price (see novaPricing.js).
  let plan = null;
  let quote = null;
  let custom = false;
  if (body.plan_id) {
    plan = await getNovaPlan(body.plan_id);
    if (!plan) throw new Error(`plan "${body.plan_id}" not found`);
    const ctx = await loadPlanContext();
    quote = quoteForPrice(plan.price_usd, ctx.settings, ctx.markup);
  } else if (body.custom_amount_usd !== undefined && body.custom_amount_usd !== null && body.custom_amount_usd !== '') {
    const ctx = await loadPlanContext();
    const paid = Number(body.custom_amount_usd);
    if (!Number.isFinite(paid) || paid < ctx.settings.custom_min_usd || paid > ctx.settings.custom_max_usd) {
      throw new Error(`custom_amount_usd must be between ${ctx.settings.custom_min_usd} and ${ctx.settings.custom_max_usd}`);
    }
    quote = quoteForPrice(paid, ctx.settings, ctx.markup);
    custom = true;
  }
  const amount = quote
    ? quote.credit_usd
    : (body.amount_usd !== undefined && body.amount_usd !== null && body.amount_usd !== '' ? Number(body.amount_usd) : NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount_usd must be a positive number');
  }
  const addMicros = usdToMicros(amount);
  const ref = String(body.payment_ref || '').trim();
  const now = new Date();
  const noteParts = [
    String(body.reason || '').trim() && `grant: ${String(body.reason).trim()}`,
    ref && `payment_ref: ${ref}`,
    body.notes != null && String(body.notes).trim(),
  ].filter(Boolean);
  const noteLine = noteParts.length ? `${now.toISOString()} ${noteParts.join(' | ')}` : '';

  const newPurchased = { $add: [microsExpr('purchased_credit'), addMicros] };
  // With a payment_ref the filter only matches a wallet that has NOT credited it yet. If the wallet exists and
  // already has the ref, the upsert would insert a second company_id, which the unique index rejects (E11000).
  const filter = ref ? { company_id: id, grant_refs: { $ne: ref } } : { company_id: id };
  let result;
  try {
    result = await CompanyNovaWallet.collection.findOneAndUpdate(
      filter,
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
          ...(plan ? { plan_name: plan.name } : {}),
          ...(ref
            ? { grant_refs: { $slice: [{ $concatArrays: [{ $ifNull: ['$grant_refs', []] }, [ref]] }, -500] } }
            : {}),
          ...(noteLine
            ? { notes: { $substrCP: [{ $concat: [{ $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n'] }, ''] }, noteLine] }, 0, 4000] } }
            : {}),
          model_tiers: { $ifNull: ['$model_tiers', {}] },
        },
      }],
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    if (err?.code === 11000 && ref) {
      return { ...walletToApi(await getWallet(id)), duplicate: true };
    }
    throw err;
  }
  const doc = result?.value ?? result;
  await recordWalletTransaction(id, {
    type: 'grant',
    amount_micros: addMicros,
    balance_after_micros: remainingMicros(doc),
    reason: body.reason || (plan ? `${plan.name} plan` : (custom ? 'Custom amount' : '')),
    payment_ref: ref,
    plan_id: plan ? plan.plan_id : (custom ? 'custom' : undefined),
    plan_name: plan ? plan.name : (custom ? 'Custom amount' : undefined),
    paid_micros: body.paid_usd != null && body.paid_usd !== ''
      ? usdToMicros(Number(body.paid_usd))
      : (quote ? usdToMicros(quote.price_usd) : null),
    actor: body.actor || (ref ? 'stripe' : 'admin'),
  });
  return { ...walletToApi(doc), duplicate: false };
}

/**
 * Take purchased credit back (a lost or open chargeback). Atomic and idempotent per `ref`: the same ref changes nothing and
 * returns `duplicate: true`. The balance may go negative when the company already spent the credit; it then stays exhausted
 * until staff settle it, which is the honest state of a disputed payment.
 * @param {string} companyId
 * @param {{ amount_micros: number, ref: string, reason?: string, actor?: string, payment_ref_note?: string }} body
 */
export async function reverseWalletCredit(companyId, body = {}) {
  const id = String(companyId || '').trim();
  const micros = Math.round(Number(body.amount_micros));
  const ref = String(body.ref || '').trim();
  if (!id || !ref || !Number.isFinite(micros) || micros <= 0) throw new Error('companyId, ref and a positive amount are required');
  const next = { $subtract: [microsExpr('purchased_credit'), micros] };
  const res = await CompanyNovaWallet.collection.findOneAndUpdate(
    { company_id: id, grant_refs: { $ne: ref } },
    [{
      $set: {
        purchased_credit_micros: next,
        purchased_credit_usd: { $divide: [next, MICROS] },
        updated_at: new Date(),
        grant_refs: { $slice: [{ $concatArrays: [{ $ifNull: ['$grant_refs', []] }, [ref]] }, -500] },
      },
    }],
    { returnDocument: 'after' },
  );
  const doc = res?.value ?? res;
  if (!doc) return { reversed: false, duplicate: true }; // no wallet, or this ref was already applied
  await recordWalletTransaction(id, {
    type: 'reversal',
    amount_micros: -micros,
    balance_after_micros: remainingMicros(doc),
    reason: body.reason || 'Credit removed',
    payment_ref: ref,
    actor: body.actor || 'stripe',
  });
  return { reversed: true, duplicate: false };
}

/**
 * Newest-first wallet history for a company (customer-safe fields only).
 * @param {string} companyId
 * @param {{ limit?: number, before?: string|Date }} [opts]
 */
export async function listWalletTransactions(companyId, { limit = 25, before } = {}) {
  const id = String(companyId || '').trim();
  if (!id) return [];
  const query = { company_id: id, app: { $ne: 'raven' } };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) query.created_at = { $lt: d };
  }
  const rows = await WalletTransaction.find(query)
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100))
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    type: r.type,
    amount_usd: r.amount_usd,
    balance_after_usd: r.balance_after_micros == null ? null : microsToUsd(r.balance_after_micros),
    plan_id: r.plan_id || '',
    plan_name: r.plan_name || '',
    paid_usd: r.paid_micros == null ? null : microsToUsd(r.paid_micros),
    reason: r.reason || '',
    payment_ref: r.payment_ref || '',
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
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
 * First use by a company with no wallet: give it the configured trial allowance (NOVA_TRIAL_ALLOWANCE_USD).
 * Race-safe: only the request whose upsert actually inserts the wallet records the trial. Returns the wallet,
 * or null when trials are off.
 * @param {string} companyId
 */
export async function provisionTrialWallet(companyId) {
  const trial = Number(config.billing?.trialAllowanceUsd) || 0;
  if (!companyId || trial <= 0) return null;
  const micros = usdToMicros(trial);
  const res = await CompanyNovaWallet.collection.updateOne(
    { company_id: companyId },
    {
      $setOnInsert: {
        company_id: companyId,
        limits_enabled: true,
        free_allowance_micros: micros,
        free_allowance_usd: microsToUsd(micros),
        purchased_credit_micros: 0,
        purchased_credit_usd: 0,
        spent_micros: 0,
        spent_usd: 0,
        notes: `${new Date().toISOString()} trial allowance $${microsToUsd(micros)}`,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
  if (res.upsertedCount === 1) {
    await recordWalletTransaction(companyId, {
      type: 'trial',
      amount_micros: micros,
      balance_after_micros: micros,
      reason: 'trial allowance on first use',
      actor: 'system',
    });
  }
  return getWallet(companyId);
}

/**
 * How much PROVIDER cost one turn may still spend before the company's credit runs out, or null when the
 * company is not limited. The wallet is debited the billable amount (provider cost x (1 + markup)), so the
 * remaining billable credit is converted back to provider dollars.
 * @param {string} companyId
 * @returns {Promise<number|null>}
 */
export async function getTurnCreditCapUsd(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  const doc = await getWallet(id);
  if (!doc || !doc.limits_enabled) return null;
  const remaining = computeRemainingUsd(doc);
  if (remaining == null) return null;
  const markup = await resolveMarkupRate(id);
  return Math.max(0, remaining) / (1 + markup);
}

const HOLD_TTL_MS = 10 * 60 * 1000; // a hold whose turn died is forgotten after this

/**
 * Hold part of a company's remaining credit for ONE running turn, atomically. Everything else the company runs at the same
 * time can only use what is not held, so two chats can never both spend the last dollar.
 *
 * One update on the wallet document: forget expired holds, work out what is free (remaining minus holds), and add this hold
 * only if at least `minMicros` is free. Returns what was granted (at most `desiredMicros`), or null when too little is free.
 *
 * @param {string} companyId
 * @param {{ holdId: string, desiredMicros: number, minMicros: number, ttlMs?: number }} opts
 * @returns {Promise<{ grantedMicros: number }|null>}
 */
export async function reserveCredit(companyId, { holdId, desiredMicros, minMicros, ttlMs = HOLD_TTL_MS }) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  const now = new Date();
  const remaining = { $subtract: [{ $add: [microsExpr('free_allowance'), microsExpr('purchased_credit')] }, microsExpr('spent')] };
  const res = await CompanyNovaWallet.collection.findOneAndUpdate(
    { company_id: id },
    [
      { $set: { holds: { $filter: { input: { $ifNull: ['$holds', []] }, as: 'h', cond: { $gt: ['$$h.expires_at', now] } } } } },
      { $set: { _free: { $subtract: [remaining, { $sum: '$holds.micros' }] } } },
      {
        $set: {
          holds: {
            $cond: [
              { $gte: ['$_free', Math.max(1, minMicros)] },
              { $concatArrays: ['$holds', [{ id: holdId, micros: { $min: ['$_free', Math.round(desiredMicros)] }, expires_at: new Date(now.getTime() + ttlMs) }]] },
              '$holds',
            ],
          },
        },
      },
      { $unset: '_free' },
    ],
    { returnDocument: 'after' },
  );
  const doc = res?.value ?? res;
  const hold = (doc?.holds || []).find((h) => h.id === holdId);
  return hold ? { grantedMicros: hold.micros } : null;
}

/** Give a turn's held credit back (what it really spent is already on the wallet). */
export async function releaseCredit(companyId, holdId) {
  const id = String(companyId || '').trim();
  if (!id || !holdId) return;
  await CompanyNovaWallet.collection.updateOne({ company_id: id }, { $pull: { holds: { id: holdId } } });
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
  // A company whose Nova subscription was paused or switched off in the AI apps hub cannot chat or run schedules.
  // (No subscription row = an existing customer: Nova keeps working under the wallet rules below.)
  const sub = await CompanyAppSubscription.findOne({ company_id: id, app: 'nova' }, { status: 1 }).lean();
  if (sub && sub.status !== 'active') {
    return {
      ok: false,
      status: 402,
      body: {
        success: false,
        code: NOVA_CREDIT_EXHAUSTED,
        remaining_usd: 0,
        message: `Nova is ${sub.status === 'paused' ? 'paused' : 'switched off'} for this company. Contact your administrator.`,
        wallet: walletToApi(await getWallet(id)),
      },
    };
  }
  let doc = await getWallet(id);
  if (!doc) doc = await provisionTrialWallet(id);
  if (!doc && config.billing?.requireWallet) {
    return {
      ok: false,
      status: 402,
      body: {
        success: false,
        code: NOVA_CREDIT_EXHAUSTED,
        remaining_usd: 0,
        message: 'Nova is not activated for this company yet. Purchase credits to start.',
        wallet: walletToApi(null),
      },
    };
  }
  if (!doc || !doc.limits_enabled) {
    return { ok: true, wallet: walletToApi(doc) };
  }
  const remaining = computeRemainingUsd(doc);
  const wallet = walletToApi(doc);
  if (remaining != null && remaining < CREDIT_FLOOR_USD) {
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
    const delta = walletMicrosSpent - ledgerMicros; // positive: spend was overstated, balance goes up
    if (delta !== 0) {
      const after = await getWallet(id);
      await recordWalletTransaction(id, {
        type: 'reconcile',
        amount_micros: delta,
        balance_after_micros: remainingMicros(after),
        reason: 'spent corrected to the usage ledger',
        actor: 'admin',
      });
    }
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
    if (d.limits_enabled) {
      status = microsToUsd(remaining) < CREDIT_FLOOR_USD
        ? 'exhausted'
        : isLowBalance({ enforced: true, remaining: microsToUsd(remaining), granted: microsToUsd(total) }) ? 'low' : 'ok';
    }
    return {
      company_id: String(d.company_id),
      display_name: d.display_name || '',
      seats: d.seats ?? null,
      enforced: Boolean(d.limits_enabled),
      free_allowance_usd: microsToUsd(walletMicros(d, 'free_allowance')),
      purchased_credit_usd: microsToUsd(walletMicros(d, 'purchased_credit')),
      spent_usd: microsToUsd(spent),
      remaining_usd: microsToUsd(remaining),
      // What the company used beyond its credit (a reply that finished after the balance reached zero). Staff only.
      overdraft_usd: remaining < 0 ? microsToUsd(-remaining) : 0,
      pct_left: pctLeft,
      markup_rate: d.markup_rate ?? null,
      status,
      updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
    };
  });
}
