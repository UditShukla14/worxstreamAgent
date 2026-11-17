/**
 * App wallets (Raven). Money is integer micro-USD of BILLABLE dollars; every write is one atomic update so
 * concurrent usage reports cannot lose a debit.
 */
import CompanyAppWallet from './models/CompanyAppWallet.js';
import WalletTransaction from '../analytics/models/WalletTransaction.js';
import { USAGE_ALERT_RATIO, sendUsageAlert } from './alerts.js';
import { usdToMicros, microsToUsd, clampMarkup } from '../analytics/costing.js';
import { CREDIT_FLOOR_USD, isLowBalance } from '../analytics/novaWallet.js';
import { config } from '../config/index.js';

const id = (v) => String(v || '').trim();
const n = (v) => (Number.isFinite(v) ? v : 0);

export const remainingMicros = (doc) => n(doc?.free_allowance_micros) + n(doc?.purchased_credit_micros) - n(doc?.spent_micros);

/** Default markup of an app: RAVEN_MARKUP_RATE, else the shared NOVA_MARKUP_RATE. */
export function defaultMarkup(app) {
  const own = app === 'raven' ? process.env.RAVEN_MARKUP_RATE : undefined;
  return clampMarkup(own !== undefined && own !== '' ? Number(own) : (config.billing?.markupRate ?? 0));
}

/**
 * Credit every company gets by default (RAVEN_DEFAULT_CREDIT_USD, $5). No company is ever unlimited: a Raven wallet without credit
 * is given this allowance the first time it is needed. 0 turns the default off (then only staff-set wallets exist).
 */
export const defaultCreditUsd = () => {
  const raw = process.env.RAVEN_DEFAULT_CREDIT_USD;
  const n = raw === undefined || raw === '' ? 5 : Number.parseFloat(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 5;
};

/** Wallet as the dashboard and the access check see it. */
export function walletView(doc, app) {
  const remaining = doc ? microsToUsd(remainingMicros(doc)) : null;
  const enforced = Boolean(doc?.limits_enabled);
  return {
    app,
    exists: Boolean(doc),
    enforced,
    company_id: doc ? String(doc.company_id) : null,
    free_allowance_usd: microsToUsd(n(doc?.free_allowance_micros)),
    purchased_credit_usd: microsToUsd(n(doc?.purchased_credit_micros)),
    spent_usd: microsToUsd(n(doc?.spent_micros)),
    remaining_usd: remaining,
    exhausted: enforced && remaining != null && remaining < CREDIT_FLOOR_USD,
    markup_rate: doc?.markup_rate ?? null,
    effective_markup_rate: clampMarkup(doc?.markup_rate ?? defaultMarkup(app)),
    notes: String(doc?.notes || ''),
    updated_at: doc?.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

export async function getAppWallet(companyId, app) {
  if (!id(companyId)) return null;
  return CompanyAppWallet.findOne({ company_id: id(companyId), app }).lean();
}

export async function getAppWalletView(companyId, app) {
  return walletView(await getAppWallet(companyId, app), app);
}

export async function resolveAppMarkup(companyId, app) {
  const doc = await CompanyAppWallet.findOne({ company_id: id(companyId), app }, { markup_rate: 1 }).lean().catch(() => null);
  return doc && doc.markup_rate != null ? clampMarkup(doc.markup_rate) : defaultMarkup(app);
}

/** Atomic update-pipeline through the driver (same pattern as the Nova wallet); returns the updated document. */
async function pipelineUpdate(filter, pipeline, { upsert = false } = {}) {
  const res = await CompanyAppWallet.collection.findOneAndUpdate(filter, pipeline, { upsert, returnDocument: 'after' });
  return res?.value ?? res ?? null;
}

const noteLine = (text) => (text ? `${new Date().toISOString()} ${text}` : '');
const appendNote = (line) =>
  line
    ? { notes: { $substrCP: [{ $concat: [{ $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n'] }, ''] }, line] }, 0, 4000] } }
    : {};

/** Set the free allowance (and optionally markup / notes). Turns enforcement on. */
export async function setAppAllowance(companyId, app, body = {}) {
  const cid = id(companyId);
  if (!cid) throw new Error('companyId is required');
  const set = { limits_enabled: true, updated_at: new Date() };
  if (body.free_allowance_usd !== undefined) {
    const usd = Number(body.free_allowance_usd);
    if (!Number.isFinite(usd) || usd < 0) throw new Error('free_allowance_usd must be a non-negative number');
    set.free_allowance_micros = usdToMicros(usd);
  }
  if (body.markup_rate !== undefined) {
    set.markup_rate = body.markup_rate === null || body.markup_rate === '' ? null : clampMarkup(body.markup_rate);
  }
  const doc = await pipelineUpdate(
    { company_id: cid, app },
    [{
      $set: {
        company_id: cid,
        app,
        free_allowance_micros: { $ifNull: ['$free_allowance_micros', 0] },
        purchased_credit_micros: { $ifNull: ['$purchased_credit_micros', 0] },
        spent_micros: { $ifNull: ['$spent_micros', 0] },
        ...set,
        ...appendNote(noteLine(body.notes ? String(body.notes).trim() : '')),
      },
    }],
    { upsert: true },
  );
  return walletView(doc, app);
}

/** One row in the wallet history (shared collection with Nova's, told apart by `app`). Never throws. */
async function recordAppTransaction(companyId, app, tx) {
  try {
    await WalletTransaction.create({
      company_id: id(companyId),
      app,
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
    if (err?.code === 11000) return; // the same payment is already in the history
    console.error('app wallet history write failed:', err?.message);
  }
}

/** Credit history of an app's wallet, newest first (customer-safe). */
export async function listAppTransactions(companyId, app, { limit = 25, before } = {}) {
  if (!id(companyId)) return [];
  const query = { company_id: id(companyId), app };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) query.created_at = { $lt: d };
  }
  const rows = await WalletTransaction.find(query).sort({ created_at: -1 }).limit(Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100)).lean();
  return rows.map((r) => ({
    id: String(r._id),
    app,
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

/** What the company itself may see of its wallet: no markup, no staff notes. */
export function customerWalletView(doc, app) {
  const v = walletView(doc, app);
  const granted = v.free_allowance_usd + v.purchased_credit_usd;
  return {
    app,
    exists: v.exists,
    enforced: v.enforced,
    free_allowance_usd: v.free_allowance_usd,
    purchased_credit_usd: v.purchased_credit_usd,
    spent_usd: v.spent_usd,
    remaining_usd: v.remaining_usd,
    exhausted: v.exhausted,
    low_balance: isLowBalance({ enforced: v.enforced, remaining: v.remaining_usd, granted }),
    updated_at: v.updated_at,
  };
}

/** Add purchased credit. `payment_ref` makes it idempotent (the same payment never credits twice). */
export async function grantAppCredits(companyId, app, body = {}) {
  const cid = id(companyId);
  if (!cid) throw new Error('companyId is required');
  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount_usd must be a positive number');
  const ref = id(body.payment_ref);
  const add = usdToMicros(amount);
  const line = noteLine([body.reason && `grant: ${String(body.reason).trim()}`, ref && `payment_ref: ${ref}`].filter(Boolean).join(' | '));
  const filter = ref ? { company_id: cid, app, grant_refs: { $ne: ref } } : { company_id: cid, app };
  let doc;
  try {
    doc = await pipelineUpdate(
      filter,
      [{
        $set: {
          company_id: cid,
          app,
          purchased_credit_micros: { $add: [{ $ifNull: ['$purchased_credit_micros', 0] }, add] },
          free_allowance_micros: { $ifNull: ['$free_allowance_micros', 0] },
          spent_micros: { $ifNull: ['$spent_micros', 0] },
          limits_enabled: true,
          updated_at: new Date(),
          ...(ref ? { grant_refs: { $slice: [{ $concatArrays: [{ $ifNull: ['$grant_refs', []] }, [ref]] }, -500] } } : {}),
          ...appendNote(line),
        },
      }],
      { upsert: true },
    );
  } catch (err) {
    if (err?.code === 11000 && ref) return { ...(await getAppWalletView(cid, app)), duplicate: true };
    throw err;
  }
  await recordAppTransaction(cid, app, {
    type: 'grant',
    amount_micros: add,
    balance_after_micros: remainingMicros(doc),
    reason: body.reason || (body.plan_name ? `${body.plan_name} plan` : ''),
    payment_ref: ref,
    plan_id: body.plan_id,
    plan_name: body.plan_name,
    paid_micros: body.paid_usd != null && body.paid_usd !== '' ? usdToMicros(Number(body.paid_usd)) : null,
    actor: body.actor || (ref ? 'stripe' : 'admin'),
  });
  return { ...walletView(doc, app), duplicate: false };
}

/**
 * Take purchased credit back (a lost or open chargeback). Idempotent per `ref`. The balance may go negative when the company
 * already spent the credit: it then stays exhausted until staff settle it.
 */
export async function reverseAppCredit(companyId, app, { amount_micros, ref, reason = '', actor = 'stripe' } = {}) {
  const cid = id(companyId);
  const micros = Math.round(Number(amount_micros));
  const key = id(ref);
  if (!cid || !key || !Number.isFinite(micros) || micros <= 0) return { reversed: false, duplicate: false };
  const doc = await pipelineUpdate(
    { company_id: cid, app, grant_refs: { $ne: key } },
    [{
      $set: {
        purchased_credit_micros: { $subtract: [{ $ifNull: ['$purchased_credit_micros', 0] }, micros] },
        grant_refs: { $slice: [{ $concatArrays: [{ $ifNull: ['$grant_refs', []] }, [key]] }, -500] },
        updated_at: new Date(),
      },
    }],
  );
  if (!doc) return { reversed: false, duplicate: true };
  await recordAppTransaction(cid, app, { type: 'reversal', amount_micros: -micros, balance_after_micros: remainingMicros(doc), reason, payment_ref: key, actor });
  return { reversed: true, duplicate: false };
}

/** Debit billable dollars (one atomic update). No wallet = nothing to debit. */
export async function debitAppWallet(companyId, app, billableUsd) {
  const micros = usdToMicros(billableUsd);
  if (!id(companyId) || !Number.isFinite(micros) || micros <= 0) return null;
  const doc = await pipelineUpdate(
    { company_id: id(companyId), app },
    [{ $set: { spent_micros: { $add: [{ $ifNull: ['$spent_micros', 0] }, micros] }, updated_at: new Date() } }],
  );
  if (doc) checkUsageAlert(doc, app); // fire and forget: an email must never slow or fail billing
  return doc;
}

export async function listAppWallets(app) {
  const docs = await CompanyAppWallet.find({ app }).lean();
  return docs.map((d) => walletView(d, app));
}

/**
 * Every Raven wallet in the shape of the Nova wallet list (analytics/novaWallet.js listWallets), so both can be shown in one table.
 * status: exhausted | low | ok | unlimited
 */
export async function listRavenWalletRows() {
  const docs = await CompanyAppWallet.find({ app: 'raven' }).lean();
  return docs.map((d) => {
    const total = n(d.free_allowance_micros) + n(d.purchased_credit_micros);
    const remaining = total - n(d.spent_micros);
    const remainingUsd = microsToUsd(remaining);
    let status = 'unlimited';
    if (d.limits_enabled) {
      status = remainingUsd < CREDIT_FLOOR_USD
        ? 'exhausted'
        : isLowBalance({ enforced: true, remaining: remainingUsd, granted: microsToUsd(total) }) ? 'low' : 'ok';
    }
    return {
      app: 'raven',
      company_id: String(d.company_id),
      display_name: '',
      seats: null,
      enforced: Boolean(d.limits_enabled),
      free_allowance_usd: microsToUsd(n(d.free_allowance_micros)),
      purchased_credit_usd: microsToUsd(n(d.purchased_credit_micros)),
      spent_usd: microsToUsd(n(d.spent_micros)),
      remaining_usd: remainingUsd,
      overdraft_usd: remaining < 0 ? microsToUsd(-remaining) : 0,
      pct_left: total > 0 ? remaining / total : null,
      markup_rate: d.markup_rate ?? null,
      status,
      updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
    };
  });
}

/**
 * Make sure the company's wallet is enforced and holds at least the default credit. Idempotent and race-safe:
 *  - no wallet                                                          -> created with the default allowance
 *  - a wallet that is not enforced (an old "unlimited" one) with no credit -> given the default allowance
 *  - a wallet that is already enforced                                  -> untouched (a duplicate-key race is ignored)
 * @returns {Promise<boolean>} true when this call set the wallet up
 */
export async function provisionDefaultWallet(companyId, app) {
  const cid = id(companyId);
  const credit = defaultCreditUsd();
  if (!cid || credit <= 0) return false;
  const micros = usdToMicros(credit);
  try {
    const doc = await pipelineUpdate(
      { company_id: cid, app, limits_enabled: { $ne: true } },
      [{
        $set: {
          company_id: cid,
          app,
          limits_enabled: true,
          free_allowance_micros: {
            $cond: [
              { $gt: [{ $add: [{ $ifNull: ['$free_allowance_micros', 0] }, { $ifNull: ['$purchased_credit_micros', 0] }] }, 0] },
              { $ifNull: ['$free_allowance_micros', 0] },
              micros,
            ],
          },
          purchased_credit_micros: { $ifNull: ['$purchased_credit_micros', 0] },
          spent_micros: { $ifNull: ['$spent_micros', 0] },
          updated_at: new Date(),
        },
      }],
      { upsert: true },
    );
    if (doc) await recordAppTransaction(cid, app, { type: 'trial', amount_micros: micros, balance_after_micros: remainingMicros(doc), reason: 'Default credit', actor: 'system' });
    return Boolean(doc);
  } catch (err) {
    if (err?.code === 11000) return false; // someone else just set this wallet up
    throw err;
  }
}

/**
 * Called after a debit: once spend reaches 80% of the credit given, send one email (see alerts.js). The claim is one atomic update
 * keyed on the credit total, so concurrent debits send it once, and adding credit starts a new cycle. Never throws.
 */
export async function checkUsageAlert(doc, app, { send } = {}) {
  try {
    if (!doc?.limits_enabled) return false;
    const granted = n(doc.free_allowance_micros) + n(doc.purchased_credit_micros);
    if (granted <= 0 || n(doc.spent_micros) < granted * USAGE_ALERT_RATIO) return false;
    const claim = await CompanyAppWallet.updateOne(
      { _id: doc._id, usage_alert_granted_micros: { $ne: granted } },
      { $set: { usage_alert_granted_micros: granted, usage_alert_at: new Date() } },
    );
    if (claim.modifiedCount !== 1) return false;
    await sendUsageAlert({
      app: app === 'raven' ? 'Raven' : app,
      companyId: doc.company_id,
      grantedUsd: microsToUsd(granted),
      spentUsd: microsToUsd(n(doc.spent_micros)),
      remainingUsd: microsToUsd(remainingMicros(doc)),
    }, send ? { send } : undefined);
    return true;
  } catch (err) {
    console.error('usage alert check failed:', err?.message || err);
    return false;
  }
}
