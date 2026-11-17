/**
 * Queries behind the ops dashboard (/admin). Everything is derived from the usage rollups
 * (llm_usage_daily), the usage ledger (llm_usage_events), conversation turns and wallets.
 *
 * Rollup row selector: each row has (company, user?, agent?, model?) — a dimension is "set" or '' (rolled up).
 * To read a slice, every dimension that is filtered or grouped must be non-empty and all others ''.
 */

import LlmUsageDaily from './models/LlmUsageDaily.js';
import LlmUsageEvent from './models/LlmUsageEvent.js';
import ConversationTurn from '../nova/models/ConversationTurn.js';
import { APPS, APP_KEYS, appForAgentKey } from '../apps/registry.js';
import { listAllWallets } from '../apps/walletsView.js';
import { getAppWalletView } from '../apps/appWallet.js';
import { parseDateRange } from './queries.js';
import { listWallets, getWalletStatus } from './novaWallet.js';
import { UNATTRIBUTED } from './recordUsage.js';

const r6 = (n) => Number((n || 0).toFixed(6));
export const dayMs = 86_400_000;

export const SUMS = {
  input_tokens: { $sum: '$input_tokens' },
  output_tokens: { $sum: '$output_tokens' },
  cache_creation_input_tokens: { $sum: '$cache_creation_input_tokens' },
  cache_read_input_tokens: { $sum: '$cache_read_input_tokens' },
  total_tokens: { $sum: '$total_tokens' },
  cost_usd: { $sum: '$cost_usd' },
  // Legacy rollup rows (before markup/billable fields) count at provider cost.
  billable_usd: { $sum: { $ifNull: ['$billable_usd', '$cost_usd'] } },
  call_count: { $sum: '$call_count' },
};

export function finishTotals(t = {}) {
  const input = t.input_tokens || 0;
  const cacheRead = t.cache_read_input_tokens || 0;
  const cacheWrite = t.cache_creation_input_tokens || 0;
  const cost = t.cost_usd || 0;
  const billable = t.billable_usd || 0;
  return {
    input_tokens: input,
    output_tokens: t.output_tokens || 0,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
    total_tokens: t.total_tokens || 0,
    call_count: t.call_count || 0,
    cost_usd: r6(cost),
    billable_usd: r6(billable),
    margin_usd: r6(billable - cost),
    margin_pct: billable > 0 ? Number((((billable - cost) / billable) * 100).toFixed(2)) : 0,
    cache_hit_rate: input + cacheRead + cacheWrite > 0 ? Number((cacheRead / (input + cacheRead + cacheWrite)).toFixed(4)) : 0,
  };
}

export const companyTotalRows = (extra = {}) => ({ user_id: '', agent_key: '', model: '', ...extra });

/**
 * App scope for the rollups. The all-agents row ('') is Nova + Raven together; an app is the set of agent rows that belong
 * to it (Raven = the 'raven' agent, Nova = every other agent and control phase), so a scoped query sums those instead.
 * `app` is '' (cumulative, the default), 'nova' or 'raven'.
 */
export const normalizeApp = (app) => (APP_KEYS.includes(String(app || '')) ? String(app) : '');
/** agent_key matcher for queries that mean "all agents together" (company/user/model/day totals). */
export const agentScope = (app) => (app === 'raven' ? 'raven' : app === 'nova' ? { $nin: ['', 'raven'] } : '');
/** agent_key matcher for queries that list agents (never the all-agents row). */
export const agentListScope = (app) => (app ? agentScope(app) : { $ne: '' });

const emptySums = () => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, total_tokens: 0, cost_usd: 0, billable_usd: 0, call_count: 0 });

/** Nova / Raven side by side, from agent rows (each agent row belongs to exactly one app, so this always adds up to the cumulative total). */
export function foldByApp(agentRows) {
  const sums = Object.fromEntries(APP_KEYS.map((k) => [k, emptySums()]));
  for (const r of agentRows) {
    const into = sums[appForAgentKey(r._id ?? r.agent_key)];
    for (const key of Object.keys(into)) into[key] += r[key] || 0;
  }
  return APP_KEYS.map((key) => ({ app: key, name: APPS[key].name, ...finishTotals(sums[key]) }));
}

export function previousRange(range) {
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMs) + 1;
  const prevTo = new Date(Date.parse(range.from) - dayMs).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(range.from) - days * dayMs).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo, days };
}

export const dateBounds = (range) => ({
  $gte: new Date(`${range.from}T00:00:00Z`),
  $lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + dayMs),
});

export async function totalsFor(range, app = '') {
  const [t] = await LlmUsageDaily.aggregate([
    { $match: { ...companyTotalRows({ agent_key: agentScope(app) }), date: { $gte: range.from, $lte: range.to }, company_id: { $ne: UNATTRIBUTED } } },
    { $group: { _id: null, ...SUMS } },
  ]);
  return finishTotals(t);
}

async function activeCounts(range, app = '') {
  const match = { date: { $gte: range.from, $lte: range.to }, company_id: { $ne: UNATTRIBUTED }, call_count: { $gt: 0 } };
  const userRows = { ...match, user_id: { $ne: '' }, agent_key: agentScope(app), model: '' };
  const [companies, users, dau] = await Promise.all([
    LlmUsageDaily.distinct('company_id', { ...match, ...companyTotalRows({ agent_key: agentScope(app) }) }),
    // One row per company+user: a scoped app spans several agent rows per user and day, so collapse them first.
    LlmUsageDaily.aggregate([{ $match: userRows }, { $group: { _id: { c: '$company_id', u: '$user_id' } } }, { $count: 'n' }]),
    LlmUsageDaily.aggregate([
      { $match: userRows },
      { $group: { _id: { d: '$date', c: '$company_id', u: '$user_id' } } },
      { $group: { _id: '$_id.d', users: { $sum: 1 } } },
    ]),
  ]);
  return {
    active_companies: companies.length,
    active_users: users[0]?.n || 0,
    dau: Object.fromEntries(dau.map((d) => [d._id, d.users])),
  };
}

async function turnsByDay(range, companyFilter = {}) {
  const rows = await ConversationTurn.aggregate([
    { $match: { created_at: dateBounds(range), ...companyFilter } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } }, turns: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.turns]));
}

/** Platform overview: KPIs with previous-period comparison, daily series, top companies, alerts. */
export async function getSummary({ from, to, app: appRaw } = {}) {
  const app = normalizeApp(appRaw);
  const range = parseDateRange(from, to);
  const prev = previousRange(range);
  const scope = agentScope(app);
  const inRange = { date: { $gte: range.from, $lte: range.to }, company_id: { $ne: UNATTRIBUTED } };

  const [cur, before, counts, prevCounts, dailyRows, turns, wallets, topCompanies, agentRows, modelRows, allAgentRows] = await Promise.all([
    totalsFor(range, app),
    totalsFor(prev, app),
    activeCounts(range, app),
    activeCounts(prev, app),
    LlmUsageDaily.aggregate([
      { $match: { ...companyTotalRows({ agent_key: scope }), ...inRange } },
      { $group: { _id: '$date', ...SUMS } },
      { $sort: { _id: 1 } },
    ]),
    app === 'raven' ? {} : turnsByDay(range), // chat turns are Nova's; Raven's unit of work is a model call (one per mail)
    listAllWallets(app),
    LlmUsageDaily.aggregate([
      { $match: { ...companyTotalRows({ agent_key: scope }), ...inRange } },
      { $group: { _id: '$company_id', ...SUMS } },
      { $sort: { billable_usd: -1 } },
      { $limit: 8 },
    ]),
    LlmUsageDaily.aggregate([
      { $match: { user_id: '', agent_key: agentListScope(app), model: '', ...inRange } },
      { $group: { _id: '$agent_key', ...SUMS } },
      { $sort: { billable_usd: -1 } },
    ]),
    LlmUsageDaily.aggregate([
      { $match: { user_id: '', agent_key: scope, model: { $ne: '' }, ...inRange } },
      { $group: { _id: '$model', ...SUMS } },
      { $sort: { billable_usd: -1 } },
    ]),
    // Both apps side by side, whatever the scope is.
    LlmUsageDaily.aggregate([
      { $match: { user_id: '', agent_key: { $ne: '' }, model: '', ...inRange } },
      { $group: { _id: '$agent_key', ...SUMS } },
    ]),
  ]);

  const turnsTotal = Object.values(turns).reduce((a, b) => a + b, 0);

  const [estimatedEvents, unappliedEvents, unattributedRows] = await Promise.all([
    LlmUsageEvent.countDocuments({ created_at: dateBounds(range), cost_estimated: true }),
    LlmUsageEvent.countDocuments({ created_at: dateBounds(range), wallet_applied: false, unattributed: { $ne: true } }),
    LlmUsageDaily.aggregate([
      { $match: { ...companyTotalRows(), company_id: UNATTRIBUTED, date: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, ...SUMS } },
    ]),
  ]);
  const unattributed = finishTotals(unattributedRows[0]);

  const walletCounts = { exhausted: 0, low: 0, ok: 0, unlimited: 0 };
  for (const w of wallets) walletCounts[w.status] = (walletCounts[w.status] || 0) + 1;

  // Fill every day in range so charts have no gaps.
  const byDate = new Map(dailyRows.map((d) => [d._id, d]));
  const daily = [];
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += dayMs) {
    const day = new Date(t).toISOString().slice(0, 10);
    const d = finishTotals(byDate.get(day));
    daily.push({ date: day, ...d, active_users: counts.dau[day] || 0, turns: turns[day] || 0 });
  }

  return {
    from: range.from,
    to: range.to,
    app,
    previous: { from: prev.from, to: prev.to },
    kpis: {
      ...cur,
      active_companies: counts.active_companies,
      active_users: counts.active_users,
      turns: turnsTotal,
      avg_cost_per_turn_usd: turnsTotal > 0 ? r6(cur.billable_usd / turnsTotal) : 0,
    },
    previous_kpis: {
      ...before,
      active_companies: prevCounts.active_companies,
      active_users: prevCounts.active_users,
    },
    by_app: foldByApp(allAgentRows),
    daily,
    top_companies: topCompanies.map((c) => ({ company_id: c._id, ...finishTotals(c) })),
    agents: agentRows.map((a) => ({ agent_key: a._id, ...finishTotals(a) })),
    models: modelRows.map((m) => ({ model: m._id, ...finishTotals(m) })),
    wallets: walletCounts,
    alerts: {
      estimated_cost_events: estimatedEvents,
      events_pending_wallet_debit: unappliedEvents,
      unattributed_cost_usd: unattributed.cost_usd,
      unattributed_calls: unattributed.call_count,
    },
  };
}

/**
 * Generic usage explorer.
 * @param {{ from?: string, to?: string, app?: string, company_id?: string, user_id?: string, agent_key?: string, model?: string, group_by?: string }} q
 *   group_by: comma list of date,company,user,agent,model,app (app = Nova / Raven)
 */
export async function getUsage(q = {}) {
  const range = parseDateRange(q.from, q.to);
  const groupBy = String(q.group_by || 'date').split(',').map((s) => s.trim()).filter(Boolean);
  const want = (name) => groupBy.includes(name);

  const app = normalizeApp(q.app);
  const userSet = want('user') || Boolean(q.user_id);
  const agentSet = want('agent') || want('app') || Boolean(q.agent_key);
  const modelSet = want('model') || Boolean(q.model);

  const match = {
    date: { $gte: range.from, $lte: range.to },
    user_id: q.user_id ? String(q.user_id) : (userSet ? { $ne: '' } : ''),
    agent_key: q.agent_key ? String(q.agent_key) : (app ? agentScope(app) : (agentSet ? { $ne: '' } : '')),
    model: q.model ? String(q.model) : (modelSet ? { $ne: '' } : ''),
    company_id: q.company_id ? String(q.company_id) : { $ne: UNATTRIBUTED },
  };

  const id = {};
  if (want('date')) id.date = '$date';
  if (want('company')) id.company_id = '$company_id';
  if (want('user')) { id.company_id = '$company_id'; id.user_id = '$user_id'; } // user ids are only unique per company
  if (want('agent')) id.agent_key = '$agent_key';
  if (want('app')) id.app = '$_app';
  if (want('model')) id.model = '$model';

  const rows = await LlmUsageDaily.aggregate([
    { $match: match },
    ...(want('app') ? [{ $addFields: { _app: { $cond: [{ $eq: ['$agent_key', 'raven'] }, 'raven', 'nova'] } } }] : []),
    { $group: { _id: Object.keys(id).length ? id : null, ...SUMS } },
    { $sort: want('date') ? { '_id.date': 1 } : { billable_usd: -1 } },
    { $limit: 5000 },
  ]);

  const totalsAgg = await LlmUsageDaily.aggregate([{ $match: match }, { $group: { _id: null, ...SUMS } }]);

  return {
    from: range.from,
    to: range.to,
    group_by: groupBy,
    filters: { app: app || null, company_id: q.company_id || null, user_id: q.user_id || null, agent_key: q.agent_key || null, model: q.model || null },
    totals: finishTotals(totalsAgg[0]),
    rows: rows.map((r) => ({ ...(r._id || {}), ...finishTotals(r) })),
  };
}

/** Companies using the agent: usage in range + users + turns + wallet, searchable. */
export async function getDirectory({ from, to, app: appRaw } = {}) {
  const app = normalizeApp(appRaw);
  const scope = agentScope(app);
  const range = parseDateRange(from, to);
  const dateMatch = { $gte: range.from, $lte: range.to };

  const [usage, firstSeen, userCounts, turnRows, wallets, agentRows] = await Promise.all([
    // A scoped app spans several agent rows per company and day: sum per day first, then count the active days once.
    LlmUsageDaily.aggregate([
      { $match: { ...companyTotalRows({ agent_key: scope }), date: dateMatch, company_id: { $ne: UNATTRIBUTED } } },
      { $group: { _id: { c: '$company_id', d: '$date' }, ...SUMS } },
      { $group: { _id: '$_id.c', last_active: { $max: '$_id.d' }, active_days: { $sum: { $cond: [{ $gt: ['$call_count', 0] }, 1, 0] } }, ...SUMS } },
    ]),
    LlmUsageDaily.aggregate([
      { $match: { ...companyTotalRows(), company_id: { $ne: UNATTRIBUTED }, call_count: { $gt: 0 } } },
      { $group: { _id: '$company_id', first_seen: { $min: '$date' }, last_seen: { $max: '$date' } } },
    ]),
    LlmUsageDaily.aggregate([
      { $match: { user_id: { $ne: '' }, agent_key: scope, model: '', date: dateMatch, company_id: { $ne: UNATTRIBUTED }, call_count: { $gt: 0 } } },
      { $group: { _id: { c: '$company_id', u: '$user_id' } } },
      { $group: { _id: '$_id.c', users: { $sum: 1 } } },
    ]),
    app === 'raven' ? [] : ConversationTurn.aggregate([
      { $match: { created_at: dateBounds(range) } },
      { $group: { _id: '$company_id', turns: { $sum: 1 }, conversations: { $addToSet: '$conversation_id' } } },
      { $project: { turns: 1, conversations: { $size: '$conversations' } } },
    ]),
    listAllWallets(),
    // Per company and agent, to show Nova and Raven side by side.
    LlmUsageDaily.aggregate([
      { $match: { user_id: '', agent_key: { $ne: '' }, model: '', date: dateMatch, company_id: { $ne: UNATTRIBUTED } } },
      { $group: { _id: { c: '$company_id', a: '$agent_key' }, ...SUMS } },
    ]),
  ]);

  const map = new Map();
  const ensure = (id) => {
    if (!map.has(id)) map.set(id, { company_id: id, display_name: '', ...finishTotals({}), active_days: 0, last_active: null, first_seen: null, last_seen: null, users: 0, turns: 0, conversations: 0, wallet: null, raven_wallet: null, by_app: foldByApp([]) });
    return map.get(id);
  };
  for (const u of usage) Object.assign(ensure(u._id), finishTotals(u), { active_days: u.active_days, last_active: u.last_active });
  for (const f of firstSeen) Object.assign(ensure(f._id), { first_seen: f.first_seen, last_seen: f.last_seen });
  for (const c of userCounts) ensure(c._id).users = c.users;
  for (const t of turnRows) Object.assign(ensure(t._id), { turns: t.turns, conversations: t.conversations });
  const agentsByCompany = new Map();
  for (const r of agentRows) {
    if (!agentsByCompany.has(r._id.c)) agentsByCompany.set(r._id.c, []);
    agentsByCompany.get(r._id.c).push({ ...r, _id: r._id.a });
  }
  for (const [company, rows] of agentsByCompany) ensure(company).by_app = foldByApp(rows);
  for (const w of wallets) {
    const row = ensure(w.company_id);
    if (w.app === 'nova') row.display_name = w.display_name || row.display_name;
    const brief = { status: w.status, remaining_usd: w.remaining_usd, pct_left: w.pct_left, enforced: w.enforced, markup_rate: w.markup_rate, spent_usd: w.spent_usd, purchased_credit_usd: w.purchased_credit_usd, free_allowance_usd: w.free_allowance_usd };
    if (w.app === 'raven') row.raven_wallet = brief;
    else row.wallet = brief;
  }
  // With an app selected, only companies that have it (usage or a wallet) are listed.
  const companies = [...map.values()]
    .filter((c) => !app || c.call_count > 0 || (app === 'nova' ? c.wallet : c.raven_wallet))
    .sort((a, b) => b.billable_usd - a.billable_usd);
  return { from: range.from, to: range.to, app, companies };
}

/** One company: totals, daily series, employees (users) with activity, agents, models, wallet. */
export async function getCompanyDetail(companyId, { from, to, app: appRaw } = {}) {
  const app = normalizeApp(appRaw);
  const scope = agentScope(app);
  const range = parseDateRange(from, to);
  const cid = String(companyId);
  const base = { company_id: cid, date: { $gte: range.from, $lte: range.to } };

  const [totals, daily, userRows, agentRows, modelRows, turnsDay, userTurns, wallet, allAgentRows, ravenWallet] = await Promise.all([
    LlmUsageDaily.aggregate([{ $match: { ...base, ...companyTotalRows({ agent_key: scope }) } }, { $group: { _id: null, ...SUMS } }]),
    LlmUsageDaily.aggregate([{ $match: { ...base, ...companyTotalRows({ agent_key: scope }) } }, { $group: { _id: '$date', ...SUMS } }, { $sort: { _id: 1 } }]),
    // Sum per user and day first (a scoped app spans several agent rows), then count each active day once.
    LlmUsageDaily.aggregate([
      { $match: { ...base, user_id: { $ne: '' }, agent_key: scope, model: '' } },
      { $group: { _id: { u: '$user_id', d: '$date' }, ...SUMS } },
      { $group: { _id: '$_id.u', last_active: { $max: '$_id.d' }, first_active: { $min: '$_id.d' }, active_days: { $sum: { $cond: [{ $gt: ['$call_count', 0] }, 1, 0] } }, ...SUMS } },
      { $sort: { billable_usd: -1 } },
    ]),
    LlmUsageDaily.aggregate([{ $match: { ...base, user_id: '', agent_key: agentListScope(app), model: '' } }, { $group: { _id: '$agent_key', ...SUMS } }, { $sort: { billable_usd: -1 } }]),
    LlmUsageDaily.aggregate([{ $match: { ...base, user_id: '', agent_key: scope, model: { $ne: '' } } }, { $group: { _id: '$model', ...SUMS } }, { $sort: { billable_usd: -1 } }]),
    app === 'raven' ? {} : turnsByDay(range, { company_id: cid }),
    app === 'raven' ? [] : ConversationTurn.aggregate([
      { $match: { company_id: cid, created_at: dateBounds(range) } },
      { $group: { _id: '$user_id', turns: { $sum: 1 }, conversations: { $addToSet: '$conversation_id' } } },
      { $project: { turns: 1, conversations: { $size: '$conversations' } } },
    ]),
    getWalletStatus(cid),
    LlmUsageDaily.aggregate([{ $match: { ...base, user_id: '', agent_key: { $ne: '' }, model: '' } }, { $group: { _id: '$agent_key', ...SUMS } }]),
    getAppWalletView(cid, 'raven'),
  ]);

  const turnsMap = new Map(userTurns.map((t) => [t._id, t]));
  const byDate = new Map(daily.map((d) => [d._id, d]));
  const series = [];
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += dayMs) {
    const day = new Date(t).toISOString().slice(0, 10);
    series.push({ date: day, ...finishTotals(byDate.get(day)), turns: turnsDay[day] || 0 });
  }

  return {
    company_id: cid,
    from: range.from,
    to: range.to,
    app,
    by_app: foldByApp(allAgentRows),
    totals: finishTotals(totals[0]),
    daily: series,
    users: userRows.map((u) => ({
      user_id: u._id,
      ...finishTotals(u),
      first_active: u.first_active,
      last_active: u.last_active,
      active_days: u.active_days,
      turns: turnsMap.get(u._id)?.turns || 0,
      conversations: turnsMap.get(u._id)?.conversations || 0,
    })),
    agents: agentRows.map((a) => ({ agent_key: a._id, ...finishTotals(a) })),
    models: modelRows.map((m) => ({ model: m._id, ...finishTotals(m) })),
    wallet,
    raven_wallet: ravenWallet,
  };
}
