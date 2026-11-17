import CompanyAppSubscription from './models/CompanyAppSubscription.js';
import { APPS, APP_KEYS, SUBSCRIPTION_STATUSES, isAppKey } from './registry.js';
import { getAppWallet, walletView, defaultCreditUsd, provisionDefaultWallet } from './appWallet.js';
import { getWalletStatus, getWallet, CREDIT_FLOOR_USD, computeRemainingUsd } from '../analytics/novaWallet.js';

const id = (v) => String(v || '').trim();

export class AppInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppInputError';
  }
}

export function assertApp(app) {
  if (!isAppKey(app)) throw new AppInputError(`app must be one of: ${APP_KEYS.join(', ')}`);
  return String(app);
}

function subscriptionView(doc, app) {
  return {
    app,
    subscribed: Boolean(doc),
    status: doc?.status ?? null,
    plan_name: doc?.plan_name ?? '',
    notes: doc?.notes ?? '',
    activated_at: doc?.activated_at ? new Date(doc.activated_at).toISOString() : null,
    updated_at: doc?.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

/** Switch an app on/off/paused for a company, and label its plan. */
export async function setSubscription(companyId, app, body = {}) {
  const cid = id(companyId);
  if (!cid) throw new AppInputError('companyId is required');
  assertApp(app);
  const set = { updated_at: new Date() };
  if (body.status !== undefined) {
    if (!SUBSCRIPTION_STATUSES.includes(body.status)) throw new AppInputError(`status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}`);
    set.status = body.status;
  }
  if (body.plan_name !== undefined) set.plan_name = String(body.plan_name).trim().slice(0, 80);
  if (body.notes !== undefined) set.notes = String(body.notes).trim().slice(0, 1000);

  const existing = await CompanyAppSubscription.findOne({ company_id: cid, app }).lean();
  if (!existing && set.status === undefined) set.status = 'active';
  const becomesActive = set.status === 'active' && existing?.status !== 'active';
  const doc = await CompanyAppSubscription.findOneAndUpdate(
    { company_id: cid, app },
    { $set: { ...set, ...(becomesActive || !existing ? { activated_at: new Date() } : {}) } },
    { upsert: true, new: true },
  ).lean();
  return subscriptionView(doc, app);
}

/**
 * Make sure the company has the app switched on after it buys credit: no row creates an active one; a row that is off becomes
 * active again (a customer who pays wants it on). A PAUSED subscription is left alone, because staff paused it on purpose.
 */
export async function ensureSubscription(companyId, app, { plan_name = '' } = {}) {
  const cid = id(companyId);
  assertApp(app);
  const existing = await CompanyAppSubscription.findOne({ company_id: cid, app }).lean();
  if (existing?.status === 'active' || existing?.status === 'paused') return subscriptionView(existing, app);
  return setSubscription(cid, app, { status: 'active', ...(plan_name && !existing?.plan_name ? { plan_name } : {}) });
}

export async function getSubscription(companyId, app) {
  const doc = await CompanyAppSubscription.findOne({ company_id: id(companyId), app }).lean();
  return subscriptionView(doc, app);
}

/** Nova's wallet in the same shape as an app wallet. */
async function novaWalletView(companyId) {
  const s = await getWalletStatus(companyId);
  return { app: 'nova', ...s, effective_markup_rate: s.effective_markup_rate };
}

/** Everything the dashboard shows for one company: both apps, each with its subscription and its own wallet. */
export async function getCompanyApps(companyId) {
  const cid = id(companyId);
  const [subs, novaWallet, ravenDoc] = await Promise.all([
    CompanyAppSubscription.find({ company_id: cid }).lean(),
    novaWalletView(cid),
    getAppWallet(cid, 'raven'),
  ]);
  const byApp = new Map(subs.map((s) => [s.app, s]));
  return {
    company_id: cid,
    apps: [
      { ...APPS.nova, subscription: subscriptionView(byApp.get('nova'), 'nova'), wallet: novaWallet },
      { ...APPS.raven, subscription: subscriptionView(byApp.get('raven'), 'raven'), wallet: walletView(ravenDoc, 'raven') },
    ],
  };
}

/**
 * May this company use this app right now?
 *  - Raven needs an active subscription and credit. A company that has never had Raven gets NOTHING for free: it is "not
 *    subscribed" and sees a message to add credit (buying or a staff top-up switches it on). Its mail works as normal meanwhile.
 *  - The default credit ($5, RAVEN_DEFAULT_CREDIT_USD) is only for companies that already had Raven without a credit limit (an
 *    active subscription whose wallet is not enforced): they are capped at it so nobody stays unlimited.
 *  - A subscription staff paused or switched off stays that way. Used-up credit blocks Raven until credit is added.
 *  - Nova keeps working for companies that never had a subscription row (existing customers); a row set to paused/off blocks it.
 *    Nova's own credit rules (assertNovaCredits) still apply separately.
 * @param {{ provisionWallet?: typeof provisionDefaultWallet }} [deps] injectable for tests
 * @returns {Promise<{ allowed: boolean, reason: 'ok'|'not_subscribed'|'paused'|'off'|'exhausted', message: string, remaining_usd: number|null }>}
 */
export async function checkAppAccess(companyId, app, { provisionWallet = provisionDefaultWallet } = {}) {
  const cid = id(companyId);
  assertApp(app);
  if (!cid) return { allowed: false, reason: 'not_subscribed', message: 'No company', remaining_usd: null };
  const sub = await CompanyAppSubscription.findOne({ company_id: cid, app }).lean();
  const name = APPS[app].name;

  if (!sub) {
    if (app === 'nova') return { allowed: true, reason: 'ok', message: '', remaining_usd: null };
    return { allowed: false, reason: 'not_subscribed', message: `Add credits to start using ${name}. Your mail keeps working as normal.`, remaining_usd: null };
  }
  if (sub.status !== 'active') {
    return { allowed: false, reason: sub.status, message: `${name} is ${sub.status === 'paused' ? 'paused' : 'switched off'} for this company.`, remaining_usd: null };
  }
  if (app === 'raven') {
    let doc = await getAppWallet(cid, 'raven');
    if ((!doc || !doc.limits_enabled) && defaultCreditUsd() > 0) {
      await provisionWallet(cid, 'raven'); // an existing unlimited company: capped at the default credit
      doc = await getAppWallet(cid, 'raven');
    }
    const wallet = walletView(doc, 'raven');
    if (wallet.enforced && wallet.remaining_usd != null && wallet.remaining_usd < CREDIT_FLOOR_USD) {
      return { allowed: false, reason: 'exhausted', message: `${name} credit is used up. Add credits to continue.`, remaining_usd: wallet.remaining_usd };
    }
    return { allowed: true, reason: 'ok', message: '', remaining_usd: wallet.enforced ? wallet.remaining_usd : null };
  }
  const doc = await getWallet(cid);
  return { allowed: true, reason: 'ok', message: '', remaining_usd: doc?.limits_enabled ? computeRemainingUsd(doc) : null };
}

/**
 * One-time catch-up, safe to run at every boot: companies that were ALREADY using Raven without a credit limit are capped at the
 * default credit. Those are the active Raven subscriptions and any company with Raven usage in the ledger that has no subscription
 * row yet (it used Raven before billing existed). Paused or switched-off subscriptions and companies that never used Raven are left alone.
 * @param {{ usageCompanyIds?: () => Promise<string[]>, provisionWallet?: typeof provisionDefaultWallet }} [deps]
 * @returns {Promise<{ capped: number, subscribed: number }>}
 */
export async function capExistingRavenCompanies({ usageCompanyIds = async () => [], provisionWallet = provisionDefaultWallet } = {}) {
  if (defaultCreditUsd() <= 0) return { capped: 0, subscribed: 0 };
  const rows = await CompanyAppSubscription.find({ app: 'raven' }, { company_id: 1, status: 1 }).lean();
  const known = new Map(rows.map((r) => [String(r.company_id), r.status]));
  let subscribed = 0;
  let capped = 0;
  for (const company of await usageCompanyIds()) {
    const cid = String(company);
    if (known.has(cid) || !cid || cid === '_unattributed') continue;
    await CompanyAppSubscription.updateOne({ company_id: cid, app: 'raven' }, { $setOnInsert: { status: 'active', plan_name: 'Existing', activated_at: new Date(), updated_at: new Date() } }, { upsert: true });
    known.set(cid, 'active');
    subscribed += 1;
  }
  for (const [cid, status] of known) {
    if (status === 'active' && (await provisionWallet(cid, 'raven'))) capped += 1;
  }
  return { capped, subscribed };
}

export async function listSubscriptions(app) {
  return CompanyAppSubscription.find(app ? { app } : {}).lean();
}
