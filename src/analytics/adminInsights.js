/**
 * Business / quality insights for the ops dashboard.
 *   getEconomics  — run-rate, unit economics, concentration, margin trend, cache savings
 *   getGrowth     — onboarding, activation, churn, stickiness, seat adoption
 *   getQuality    — failure rate, tool failures, latency, expensive turns, context pressure
 *   getWalletsInsights — wallet list with burn rate / runway + free→paid conversion
 *   getModelsOverview  — models we offer: limits, capabilities, Anthropic cost and customer price
 *
 * Revenue = billable (customer-facing); cost = Anthropic provider cost. Both come from usage rollups.
 */

import LlmUsageDaily from './models/LlmUsageDaily.js';
import ConversationTurn from '../nova/models/ConversationTurn.js';
import { parseDateRange } from './queries.js';
import { UNATTRIBUTED } from './recordUsage.js';
import { listWallets } from './novaWallet.js';
import { listAllWallets } from '../apps/walletsView.js';
import { MODEL_CATALOG, resolveModelRates, PRICING_SOURCE_URL, PRICING_VERSION } from './modelPricing.js';
import { DEFAULT_TASK_MODELS } from './taskModels.js';
import { getModelLimits, listLiveModels } from '../llm/modelLimits.js';
import { getAvailableTools } from '../mcp/server.js';
import { config } from '../config/index.js';
import {
  SUMS, finishTotals, companyTotalRows, dateBounds, dayMs, totalsFor, normalizeApp, agentScope, agentListScope, foldByApp,
} from './adminQueries.js';

const r2 = (n) => Number((n || 0).toFixed(2));
const r4 = (n) => Number((n || 0).toFixed(4));
const r6 = (n) => Number((n || 0).toFixed(6));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (day, n) => iso(Date.parse(`${day}T00:00:00Z`) + n * dayMs);
const safeDiv = (a, b) => (b > 0 ? a / b : 0);
const attributed = { company_id: { $ne: UNATTRIBUTED } };

function* eachDay(from, to) {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += dayMs) yield iso(t);
}

/** Distinct employees (company+user) active in a range, per-day counts and per-user active days. */
async function employeeActivity(from, to, app = '') {
  const raw = await LlmUsageDaily.aggregate([
    { $match: { ...attributed, date: { $gte: from, $lte: to }, user_id: { $ne: '' }, agent_key: agentScope(app), model: '', call_count: { $gt: 0 } } },
    { $project: { company_id: 1, user_id: 1, date: 1 } },
  ]);
  // A scoped app has several agent rows per user and day: count each employee-day once.
  const seen = new Set();
  const rows = raw.filter((r) => {
    const key = `${r.company_id}\u0000${r.user_id}\u0000${r.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const perDay = {};
  const perUser = new Map();
  const perCompany = new Map();
  for (const r of rows) {
    perDay[r.date] = (perDay[r.date] || 0) + 1;
    const k = `${r.company_id}\u0000${r.user_id}`;
    perUser.set(k, (perUser.get(k) || 0) + 1);
    if (!perCompany.has(r.company_id)) perCompany.set(r.company_id, new Set());
    perCompany.get(r.company_id).add(r.user_id);
  }
  return { perDay, users: perUser.size, activeDaysTotal: rows.length, perCompany, rows };
}

// ───────────────────────────── Economics ─────────────────────────────

export async function getEconomics({ from, to, app: appRaw } = {}) {
  const app = normalizeApp(appRaw);
  const scope = agentScope(app);
  const range = parseDateRange(from, to);
  const today = iso(Date.now());
  const t30 = { from: addDays(today, -29), to: today };
  const p30 = { from: addDays(today, -59), to: addDays(today, -30) };
  const monthStart = `${today.slice(0, 8)}01`;
  const dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const dayOfMonth = Number(today.slice(8, 10));
  const inRange = { date: { $gte: range.from, $lte: range.to }, ...attributed };

  const [cur, trail, prevTrail, mtd, daily, companyRows, agentRows, modelRows, activity, turns, allAgentRows] = await Promise.all([
    totalsFor(range, app),
    totalsFor(t30, app),
    totalsFor(p30, app),
    totalsFor({ from: monthStart, to: today }, app),
    LlmUsageDaily.aggregate([{ $match: { ...inRange, ...companyTotalRows({ agent_key: scope }) } }, { $group: { _id: '$date', ...SUMS } }, { $sort: { _id: 1 } }]),
    LlmUsageDaily.aggregate([{ $match: { ...inRange, ...companyTotalRows({ agent_key: scope }) } }, { $group: { _id: '$company_id', ...SUMS } }, { $sort: { billable_usd: -1 } }]),
    LlmUsageDaily.aggregate([{ $match: { ...inRange, user_id: '', agent_key: agentListScope(app), model: '' } }, { $group: { _id: '$agent_key', ...SUMS } }, { $sort: { billable_usd: -1 } }]),
    LlmUsageDaily.aggregate([{ $match: { ...inRange, user_id: '', agent_key: scope, model: { $ne: '' } } }, { $group: { _id: '$model', ...SUMS } }, { $sort: { billable_usd: -1 } }]),
    employeeActivity(range.from, range.to, app),
    app === 'raven' ? 0 : ConversationTurn.countDocuments({ created_at: dateBounds(range) }), // chat turns are Nova's
    LlmUsageDaily.aggregate([{ $match: { ...inRange, user_id: '', agent_key: { $ne: '' }, model: '' } }, { $group: { _id: '$agent_key', ...SUMS } }]),
  ]);

  // run-rate (independent of the selected range)
  const projected = dayOfMonth > 0 ? (mtd.billable_usd / dayOfMonth) * dim : 0;
  const runrate = {
    trailing_30d_billable: trail.billable_usd,
    trailing_30d_cost: trail.cost_usd,
    previous_30d_billable: prevTrail.billable_usd,
    growth_pct: prevTrail.billable_usd > 0 ? r2(((trail.billable_usd - prevTrail.billable_usd) / prevTrail.billable_usd) * 100) : null,
    mtd_billable: mtd.billable_usd,
    mtd_cost: mtd.cost_usd,
    projected_month_billable: r2(projected),
    days_elapsed: dayOfMonth,
    days_in_month: dim,
  };

  // unit economics for the selected range
  const calls = cur.call_count;
  const unit = {
    turns,
    active_employees: activity.users,
    revenue_per_turn: r6(safeDiv(cur.billable_usd, turns)),
    cost_per_turn: r6(safeDiv(cur.cost_usd, turns)),
    revenue_per_employee: r4(safeDiv(cur.billable_usd, activity.users)),
    cost_per_employee: r4(safeDiv(cur.cost_usd, activity.users)),
    calls_per_turn: r2(safeDiv(calls, turns)),
    revenue_per_call: r6(safeDiv(cur.billable_usd, calls)),
    cost_per_call: r6(safeDiv(cur.cost_usd, calls)),
    margin_pct: cur.margin_pct,
  };

  // concentration
  const total = companyRows.reduce((a, c) => a + (c.billable_usd || 0), 0);
  const share = (n) => r2(safeDiv(companyRows.slice(0, n).reduce((a, c) => a + c.billable_usd, 0), total) * 100);
  const concentration = {
    total_billable: r6(total),
    companies: companyRows.length,
    top1_pct: share(1),
    top3_pct: share(3),
    top5_pct: share(5),
    top: companyRows.slice(0, 5).map((c) => ({ company_id: c._id, billable_usd: r6(c.billable_usd), share_pct: r2(safeDiv(c.billable_usd, total) * 100) })),
  };

  // margin trend
  const byDate = new Map(daily.map((d) => [d._id, d]));
  const margin_trend = [...eachDay(range.from, range.to)].map((day) => {
    const d = finishTotals(byDate.get(day));
    return { date: day, billable_usd: d.billable_usd, cost_usd: d.cost_usd, margin_usd: d.margin_usd, margin_pct: d.margin_pct };
  });

  const slice = (rows, key) => rows.map((r) => {
    const t = finishTotals(r);
    return {
      [key]: r._id,
      ...t,
      revenue_per_call: r6(safeDiv(t.billable_usd, t.call_count)),
      cost_per_call: r6(safeDiv(t.cost_usd, t.call_count)),
      share_pct: r2(safeDiv(t.billable_usd, cur.billable_usd) * 100),
    };
  });

  // prompt-cache savings, priced per model from the catalog
  let savedRead = 0, writePremium = 0, readTokens = 0, writeTokens = 0;
  const cacheByModel = modelRows.map((m) => {
    const rates = resolveModelRates(m._id);
    const saved = ((m.cache_read_input_tokens || 0) * (rates.inputPerMillion - rates.cacheReadPerMillion)) / 1e6;
    const premium = ((m.cache_creation_input_tokens || 0) * (rates.cacheWritePerMillion - rates.inputPerMillion)) / 1e6;
    savedRead += saved; writePremium += premium;
    readTokens += m.cache_read_input_tokens || 0; writeTokens += m.cache_creation_input_tokens || 0;
    return { model: m._id, cache_read_tokens: m.cache_read_input_tokens || 0, cache_write_tokens: m.cache_creation_input_tokens || 0, saved_usd: r4(saved), write_premium_usd: r4(premium), net_saved_usd: r4(saved - premium) };
  });
  const net = savedRead - writePremium;
  const cache = {
    read_tokens: readTokens,
    write_tokens: writeTokens,
    saved_usd: r4(savedRead),
    write_premium_usd: r4(writePremium),
    net_saved_usd: r4(net),
    cost_without_cache_usd: r4(cur.cost_usd + net),
    saved_pct: r2(safeDiv(net, cur.cost_usd + net) * 100),
    hit_rate: cur.cache_hit_rate,
    by_model: cacheByModel,
  };

  return {
    from: range.from, to: range.to,
    app,
    by_app: foldByApp(allAgentRows),
    totals: cur,
    runrate, unit, concentration, margin_trend,
    agents: slice(agentRows, 'agent_key'),
    models: slice(modelRows, 'model'),
    cache,
  };
}

// ───────────────────────────── Growth ─────────────────────────────

const INACTIVE_DAYS = 14;

export async function getGrowth({ from, to } = {}) {
  const range = parseDateRange(from, to);
  const [lifecycle, wallets, activity, activityPrev] = await Promise.all([
    LlmUsageDaily.aggregate([
      { $match: { ...attributed, ...companyTotalRows(), call_count: { $gt: 0 } } },
      { $group: { _id: '$company_id', first_seen: { $min: '$date' }, last_seen: { $max: '$date' }, lifetime_billable: { $sum: { $ifNull: ['$billable_usd', '$cost_usd'] } }, calls: { $sum: '$call_count' } } },
    ]),
    listWallets(),
    employeeActivity(range.from, range.to),
    employeeActivity(addDays(range.from, -(Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMs) + 1)), addDays(range.from, -1)),
  ]);

  const walletBy = new Map(wallets.map((w) => [w.company_id, w]));
  const life = new Map(lifecycle.map((l) => [l._id, l]));
  const cutoff = addDays(range.to, -INACTIVE_DAYS);
  const label = (id) => walletBy.get(id)?.display_name || '';

  const newCompanies = lifecycle
    .filter((l) => l.first_seen >= range.from && l.first_seen <= range.to)
    .sort((a, b) => (a.first_seen < b.first_seen ? 1 : -1))
    .map((l) => ({ company_id: l._id, display_name: label(l._id), first_seen: l.first_seen, last_seen: l.last_seen, lifetime_billable_usd: r4(l.lifetime_billable) }));

  const inactive = lifecycle
    .filter((l) => l.last_seen < cutoff)
    .sort((a, b) => b.lifetime_billable - a.lifetime_billable)
    .map((l) => ({
      company_id: l._id, display_name: label(l._id), last_seen: l.last_seen,
      days_inactive: Math.round((Date.parse(range.to) - Date.parse(l.last_seen)) / dayMs),
      lifetime_billable_usd: r4(l.lifetime_billable), wallet_status: walletBy.get(l._id)?.status || 'none',
    }));

  const activeInRange = lifecycle.filter((l) => l.last_seen >= range.from && l.first_seen <= range.to).length;

  const notActivated = wallets.filter((w) => !life.has(w.company_id))
    .map((w) => ({ company_id: w.company_id, display_name: w.display_name, wallet_status: w.status, remaining_usd: w.remaining_usd, updated_at: w.updated_at }));
  const walletCount = wallets.length;
  const activated = wallets.filter((w) => life.has(w.company_id)).length;

  // cumulative activated companies over time
  const startedBefore = lifecycle.filter((l) => l.first_seen < range.from).length;
  const startsByDay = {};
  for (const l of lifecycle) startsByDay[l.first_seen] = (startsByDay[l.first_seen] || 0) + 1;
  let running = startedBefore;
  const cumulative = [...eachDay(range.from, range.to)].map((day) => {
    running += startsByDay[day] || 0;
    return { date: day, companies: running, new_companies: startsByDay[day] || 0 };
  });

  // stickiness
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMs) + 1;
  const dauSeries = [...eachDay(range.from, range.to)].map((d) => ({ date: d, active_employees: activity.perDay[d] || 0 }));
  const avgDau = safeDiv(dauSeries.reduce((a, d) => a + d.active_employees, 0), days);
  const wauFrom = addDays(range.to, -6);
  const wau = new Set(activity.rows.filter((r) => r.date >= wauFrom).map((r) => `${r.company_id}\u0000${r.user_id}`)).size;
  const stickiness = {
    avg_dau: r2(avgDau),
    wau,
    mau: activity.users,
    previous_mau: activityPrev.users,
    dau_mau_pct: r2(safeDiv(avgDau, activity.users) * 100),
    avg_active_days_per_employee: r2(safeDiv(activity.activeDaysTotal, activity.users)),
    series: dauSeries,
  };

  // seat adoption (needs admin-set seats on the wallet)
  const adoption = wallets
    .filter((w) => w.seats > 0)
    .map((w) => {
      const active = activity.perCompany.get(w.company_id)?.size || 0;
      return { company_id: w.company_id, display_name: w.display_name, seats: w.seats, active_employees: active, adoption_pct: r2((active / w.seats) * 100) };
    })
    .sort((a, b) => a.adoption_pct - b.adoption_pct);
  const seatTotals = adoption.reduce((a, c) => ({ seats: a.seats + c.seats, active: a.active + c.active_employees }), { seats: 0, active: 0 });

  const onboardedIds = new Set([...life.keys(), ...walletBy.keys()]);
  return {
    from: range.from, to: range.to, inactive_days_threshold: INACTIVE_DAYS,
    counts: {
      onboarded_companies: onboardedIds.size,
      active_in_range: activeInRange,
      new_in_range: newCompanies.length,
      inactive: inactive.length,
      wallets: walletCount,
      activated_wallets: activated,
      activation_rate_pct: r2(safeDiv(activated, walletCount) * 100),
    },
    stickiness,
    cumulative,
    new_companies: newCompanies,
    inactive,
    not_activated: notActivated,
    adoption,
    adoption_overall_pct: r2(safeDiv(seatTotals.active, seatTotals.seats) * 100),
    seats_configured: adoption.length,
  };
}

// ───────────────────────────── Quality ─────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export async function getQuality({ from, to } = {}) {
  const range = parseDateRange(from, to);
  const match = { created_at: dateBounds(range) };

  const [statusAgg, toolAgg, capHits, durations, latencyDaily, expensive, ctxAgg, dailyStatus] = await Promise.all([
    ConversationTurn.aggregate([{ $match: match }, { $group: { _id: '$log.status', n: { $sum: 1 } } }]),
    ConversationTurn.aggregate([
      { $match: match },
      { $unwind: '$log.tools' },
      { $group: { _id: '$log.tools.tool', calls: { $sum: 1 }, failures: { $sum: { $cond: [{ $eq: ['$log.tools.ok', false] }, 1, 0] } } } },
      { $sort: { calls: -1 } },
      { $limit: 200 },
    ]),
    ConversationTurn.countDocuments({ ...match, 'log.usage.spend_cap_hit': true }),
    ConversationTurn.find({ ...match, 'log.duration_ms': { $gt: 0 } }).select('log.duration_ms').limit(10000).lean(),
    ConversationTurn.aggregate([
      { $match: { ...match, 'log.duration_ms': { $gt: 0 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } }, avg_ms: { $avg: '$log.duration_ms' }, turns: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    ConversationTurn.find({ ...match, 'log.usage.turn_cost_usd': { $gt: 0 } })
      .sort({ 'log.usage.turn_cost_usd': -1 }).limit(10)
      .select('company_id user_id conversation_id created_at log.status log.usage.turn_cost_usd log.usage.total_tokens log.usage.spend_cap_hit log.tools log.duration_ms').lean(),
    ConversationTurn.aggregate([
      { $match: { ...match, 'log.usage.context.used_tokens': { $gt: 0 } } },
      {
        $group: {
          _id: null,
          turns: { $sum: 1 },
          avg_pct: { $avg: '$log.usage.context.used_pct_of_budget' },
          max_pct: { $max: '$log.usage.context.used_pct_of_budget' },
          over_soft: { $sum: { $cond: [{ $gte: ['$log.usage.context.used_tokens', { $ifNull: ['$log.usage.context.thresholds.soft', Number.MAX_SAFE_INTEGER] }] }, 1, 0] } },
          over_hard: { $sum: { $cond: [{ $gte: ['$log.usage.context.used_tokens', { $ifNull: ['$log.usage.context.thresholds.hard', Number.MAX_SAFE_INTEGER] }] }, 1, 0] } },
          history_trimmed: { $sum: { $cond: [{ $gt: ['$log.usage.context.history_turns_dropped', 0] }, 1, 0] } },
          results_cleared: { $sum: { $cond: [{ $gt: ['$log.usage.context.tool_results_cleared', 0] }, 1, 0] } },
        },
      },
    ]),
    ConversationTurn.aggregate([
      { $match: match },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } } }, turns: { $sum: 1 }, errors: { $sum: { $cond: [{ $eq: ['$log.status', 'error'] }, 1, 0] } }, incomplete: { $sum: { $cond: [{ $eq: ['$log.status', 'waiting_continue'] }, 1, 0] } } } },
      { $sort: { '_id.d': 1 } },
    ]),
  ]);

  const statusCounts = Object.fromEntries(statusAgg.map((s) => [s._id || 'unknown', s.n]));
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const pct = (n) => r2(safeDiv(n || 0, total) * 100);

  const ms = durations.map((d) => d.log?.duration_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const latency = {
    available: ms.length > 0,
    sample: ms.length,
    p50_ms: percentile(ms, 50),
    p95_ms: percentile(ms, 95),
    avg_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    daily: latencyDaily.map((d) => ({ date: d._id, avg_ms: Math.round(d.avg_ms), turns: d.turns })),
  };

  const tools = toolAgg.map((t) => ({ tool: t._id, calls: t.calls, failures: t.failures, failure_rate_pct: r2(safeDiv(t.failures, t.calls) * 100) }));
  const usedNames = new Set(tools.map((t) => t.tool));
  const registry = getAvailableTools();
  const unused = registry.length ? registry.filter((n) => !usedNames.has(n)) : [];

  const c = ctxAgg[0] || {};
  const dailyMap = new Map(dailyStatus.map((d) => [d._id.d, d]));
  const daily = [...eachDay(range.from, range.to)].map((day) => {
    const d = dailyMap.get(day);
    return { date: day, turns: d?.turns || 0, errors: d?.errors || 0, incomplete: d?.incomplete || 0, error_rate_pct: d ? r2(safeDiv(d.errors, d.turns) * 100) : 0 };
  });

  return {
    from: range.from, to: range.to,
    turns: total,
    outcomes: {
      completed: statusCounts.completed || 0,
      error: statusCounts.error || 0,
      waiting_continue: statusCounts.waiting_continue || 0,
      clarify: (statusCounts.clarify || 0) + (statusCounts.plan_clarify || 0),
      pending_confirmation: statusCounts.pending_confirmation || 0,
      stopped: statusCounts.stopped || 0,
      spend_cap_hits: capHits,
      error_rate_pct: pct(statusCounts.error),
      incomplete_rate_pct: pct(statusCounts.waiting_continue),
      success_rate_pct: pct(statusCounts.completed),
    },
    daily,
    latency,
    tools: tools.slice(0, 40),
    tool_failures: [...tools].filter((t) => t.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 15),
    unused_tools: { registered: registry.length, unused_count: unused.length, sample: unused.slice(0, 40) },
    expensive_turns: expensive.map((t) => ({
      company_id: t.company_id, user_id: t.user_id, conversation_id: t.conversation_id, at: t.created_at,
      provider_cost_usd: r4(t.log?.usage?.turn_cost_usd), tokens: t.log?.usage?.total_tokens || 0,
      tool_calls: t.log?.tools?.length || 0, status: t.log?.status, duration_ms: t.log?.duration_ms ?? null, hit_cap: Boolean(t.log?.usage?.spend_cap_hit),
    })),
    context: {
      measured_turns: c.turns || 0,
      avg_used_pct_of_budget: c.avg_pct != null ? r2(c.avg_pct) : null,
      max_used_pct_of_budget: c.max_pct != null ? r2(c.max_pct) : null,
      over_soft: c.over_soft || 0,
      over_hard: c.over_hard || 0,
      history_trimmed: c.history_trimmed || 0,
      tool_results_cleared: c.results_cleared || 0,
      over_soft_pct: r2(safeDiv(c.over_soft || 0, c.turns || 0) * 100),
    },
  };
}

// ───────────────────────────── Wallets: burn rate & runway ─────────────────────────────

const BURN_WINDOW_DAYS = 14;

export async function getWalletsInsights({ app: appRaw } = {}) {
  const app = normalizeApp(appRaw);
  const today = iso(Date.now());
  const from = addDays(today, -(BURN_WINDOW_DAYS - 1));
  const burnOf = (scope) => LlmUsageDaily.aggregate([
    { $match: { ...attributed, ...companyTotalRows({ agent_key: scope }), date: { $gte: from, $lte: today } } },
    { $group: { _id: '$company_id', billable: { $sum: { $ifNull: ['$billable_usd', '$cost_usd'] } } } },
  ]);
  // Each wallet burns only its own app's usage: Nova's wallet pays for Nova, Raven's for Raven.
  const [wallets, novaBurn, ravenBurn] = await Promise.all([listAllWallets(app), burnOf(agentScope('nova')), burnOf(agentScope('raven'))]);
  const burnMaps = { nova: new Map(novaBurn.map((b) => [b._id, b.billable / BURN_WINDOW_DAYS])), raven: new Map(ravenBurn.map((b) => [b._id, b.billable / BURN_WINDOW_DAYS])) };

  const rows = wallets.map((w) => {
    const perDay = burnMaps[w.app]?.get(w.company_id) || 0;
    const runway = w.enforced && w.remaining_usd > 0 && perDay > 0 ? w.remaining_usd / perDay : null;
    return {
      ...w,
      burn_per_day_usd: r4(perDay),
      runway_days: runway != null ? Math.round(runway * 10) / 10 : null,
      projected_exhaustion: runway != null ? addDays(today, Math.floor(runway)) : null,
    };
  });

  const enforced = rows.filter((w) => w.enforced);
  const usedFree = rows.filter((w) => w.free_allowance_usd > 0 && w.spent_usd >= w.free_allowance_usd);
  const converted = usedFree.filter((w) => w.purchased_credit_usd > 0);
  const summary = {
    app,
    burn_window_days: BURN_WINDOW_DAYS,
    companies: new Set(rows.map((w) => w.company_id)).size,
    wallets: rows.length,
    exhausted: rows.filter((w) => w.status === 'exhausted').length,
    low: rows.filter((w) => w.status === 'low').length,
    runway_under_7d: rows.filter((w) => w.runway_days != null && w.runway_days < 7).length,
    outstanding_credit_usd: r2(enforced.reduce((a, w) => a + Math.max(0, w.remaining_usd), 0)), // prepaid balance still owed as service
    purchased_total_usd: r2(rows.reduce((a, w) => a + w.purchased_credit_usd, 0)),
    free_allowance_total_usd: r2(rows.reduce((a, w) => a + w.free_allowance_usd, 0)),
    exhausted_free_allowance: usedFree.length,
    converted_to_paid: converted.length,
    conversion_pct: r2(safeDiv(converted.length, usedFree.length) * 100),
    by_app: ['nova', 'raven'].map((key) => {
      const own = rows.filter((w) => w.app === key);
      return { app: key, wallets: own.length, outstanding_credit_usd: r2(own.filter((w) => w.enforced).reduce((a, w) => a + Math.max(0, w.remaining_usd), 0)), purchased_total_usd: r2(own.reduce((a, w) => a + w.purchased_credit_usd, 0)), exhausted: own.filter((w) => w.status === 'exhausted').length };
    }),
  };
  return { wallets: rows, summary };
}

// ───────────────────────────── Models we offer ─────────────────────────────

export async function getModelsOverview({ from, to } = {}) {
  const range = parseDateRange(from, to);
  const markup = config.billing?.markupRate ?? 0;
  const live = new Map(listLiveModels().map((m) => [m.id, m]));
  const usage = await LlmUsageDaily.aggregate([
    { $match: { ...attributed, date: { $gte: range.from, $lte: range.to }, user_id: '', agent_key: '', model: { $ne: '' } } },
    { $group: { _id: '$model', ...SUMS } },
  ]);
  const usageBy = new Map(usage.map((u) => [u._id, finishTotals(u)]));

  const tierUse = {
    [config.anthropic.model]: ['Medium tier — agents (Nova + specialists)'],
    [config.anthropic.fastModel]: ['Daily tier — router, plan, summary, formatter'],
  };
  for (const [tier, id] of Object.entries(DEFAULT_TASK_MODELS)) {
    if (!['daily', 'medium'].includes(tier)) (tierUse[id] ||= []).push(`${tier[0].toUpperCase()}${tier.slice(1)} tier (not active)`);
  }

  const price = (m) => ({
    input_per_million: m.inputPerMillion,
    output_per_million: m.outputPerMillion,
    cache_write_per_million: m.cacheWritePerMillion,
    cache_read_per_million: m.cacheReadPerMillion,
    customer_input_per_million: r4(m.inputPerMillion * (1 + markup)),
    customer_output_per_million: r4(m.outputPerMillion * (1 + markup)),
  });

  const models = MODEL_CATALOG.map((m) => {
    const limits = getModelLimits(m.id);
    const liveHit = live.get(m.id) || [...live.values()].find((l) => l.id.startsWith(`${m.id}-`));
    const used = usageBy.get(m.id);
    return {
      id: m.id,
      name: m.name,
      family: m.family,
      tier_hint: m.tierHint || null,
      context_window: limits.contextWindow,
      max_output: limits.maxOutput,
      limits_source: limits.source,
      available_on_key: Boolean(liveHit),
      capabilities: limits.capabilities,
      ...price(m),
      long_context: m.ratesOverThreshold
        ? { above_tokens: m.inputTokensThreshold, input_per_million: m.ratesOverThreshold.inputPerMillion, output_per_million: m.ratesOverThreshold.outputPerMillion }
        : null,
      pricing_verified: m.pricingVerified !== false,
      in_use_as: tierUse[m.id] || [],
      usage: used ? { calls: used.call_count, tokens: used.total_tokens, revenue_usd: used.billable_usd, cost_usd: used.cost_usd } : null,
    };
  });

  // models the key can use that we have no price for (billing would be an estimate)
  const catalogIds = new Set(MODEL_CATALOG.map((m) => m.id));
  const unpriced = [...live.values()]
    .filter((l) => !catalogIds.has(l.id) && ![...catalogIds].some((id) => l.id.startsWith(`${id}-`)))
    .map((l) => ({ id: l.id, context_window: l.contextWindow, max_output: l.maxOutput }));

  return {
    from: range.from, to: range.to,
    markup_rate: markup,
    pricing_version: PRICING_VERSION,
    pricing_source: PRICING_SOURCE_URL,
    limits_from_api: live.size > 0,
    configured: { medium: config.anthropic.model, daily: config.anthropic.fastModel },
    models,
    unpriced_available: unpriced,
  };
}
