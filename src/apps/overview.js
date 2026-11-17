/**
 * Hub overview: for each AI app, who has it, what it used and what is left, so one dashboard can run both.
 */
import LlmUsageDaily from '../analytics/models/LlmUsageDaily.js';
import { parseDateRange } from '../analytics/queries.js';
import { listWallets as listNovaWallets } from '../analytics/novaWallet.js';
import { listAppWallets } from './appWallet.js';
import { listSubscriptions } from './subscriptions.js';
import { APPS, APP_KEYS } from './registry.js';

const emptyUsage = () => ({ total_tokens: 0, call_count: 0, cost_usd: 0, billable_usd: 0 });
const addUsage = (into, row) => {
  into.total_tokens += row.total_tokens || 0;
  into.call_count += row.call_count || 0;
  into.cost_usd += row.cost_usd || 0;
  into.billable_usd += row.billable_usd || 0;
};
const subtract = (a, b) => ({
  total_tokens: Math.max(0, a.total_tokens - b.total_tokens),
  call_count: Math.max(0, a.call_count - b.call_count),
  cost_usd: Math.max(0, a.cost_usd - b.cost_usd),
  billable_usd: Math.max(0, a.billable_usd - b.billable_usd),
});

/** Usage per company and app: Raven = the 'raven' agent rows; Nova = everything else (company total minus Raven). */
async function usageByCompany(range) {
  const rows = await LlmUsageDaily.find({
    date: { $gte: range.from, $lte: range.to },
    user_id: '',
    model: '',
    agent_key: { $in: ['', 'raven'] },
  }).lean();
  const totals = new Map();
  const raven = new Map();
  for (const r of rows) {
    const target = r.agent_key === 'raven' ? raven : totals;
    if (!target.has(r.company_id)) target.set(r.company_id, emptyUsage());
    addUsage(target.get(r.company_id), r);
  }
  const out = new Map();
  for (const [company, total] of totals) {
    const r = raven.get(company) || emptyUsage();
    out.set(company, { nova: subtract(total, r), raven: r });
  }
  for (const [company, r] of raven) if (!out.has(company)) out.set(company, { nova: emptyUsage(), raven: r });
  return out;
}

const walletBrief = (w) => (w ? { enforced: w.enforced, remaining_usd: w.remaining_usd, status: w.status ?? (w.exhausted ? 'exhausted' : w.enforced ? 'ok' : 'unlimited') } : null);

export async function getAppsOverview({ from, to } = {}) {
  const range = parseDateRange(from, to);
  const [usage, subs, novaWallets, ravenWallets] = await Promise.all([
    usageByCompany(range),
    listSubscriptions(),
    listNovaWallets(),
    listAppWallets('raven'),
  ]);

  const subBy = new Map(subs.map((s) => [`${s.company_id}|${s.app}`, s]));
  const novaBy = new Map(novaWallets.map((w) => [w.company_id, w]));
  const ravenBy = new Map(ravenWallets.map((w) => [w.company_id, w]));
  const companies = new Set([...usage.keys(), ...subs.map((s) => s.company_id), ...novaBy.keys(), ...ravenBy.keys()]);
  companies.delete('_unattributed');

  const rows = [...companies].map((company_id) => {
    const u = usage.get(company_id) || { nova: emptyUsage(), raven: emptyUsage() };
    const entry = (app, wallet) => {
      const sub = subBy.get(`${company_id}|${app}`);
      return { status: sub?.status ?? (app === 'nova' ? 'implicit' : 'not_subscribed'), plan_name: sub?.plan_name ?? '', usage: u[app], wallet: walletBrief(wallet) };
    };
    return {
      company_id,
      display_name: novaBy.get(company_id)?.display_name || '',
      nova: entry('nova', novaBy.get(company_id)),
      raven: entry('raven', ravenBy.get(company_id)),
    };
  });
  rows.sort((a, b) => b.nova.usage.billable_usd + b.raven.usage.billable_usd - (a.nova.usage.billable_usd + a.raven.usage.billable_usd));

  const apps = APP_KEYS.map((key) => {
    const subscribers = { active: 0, paused: 0, off: 0, implicit: 0 };
    const usageTotal = emptyUsage();
    let remaining = 0;
    let exhausted = 0;
    for (const row of rows) {
      const e = row[key];
      subscribers[e.status] = (subscribers[e.status] ?? 0) + 1;
      addUsage(usageTotal, e.usage);
      if (e.wallet?.enforced && e.wallet.remaining_usd != null) remaining += e.wallet.remaining_usd;
      if (e.wallet?.status === 'exhausted') exhausted += 1;
    }
    // "implicit" Nova companies (no subscription row, still working) count as active for the headline number.
    return { ...APPS[key], subscribers: { ...subscribers, total_active: subscribers.active + (key === 'nova' ? subscribers.implicit : 0) }, usage: usageTotal, wallets: { remaining_usd: remaining, exhausted } };
  });

  return { from: range.from, to: range.to, apps, companies: rows };
}
