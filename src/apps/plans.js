/**
 * Credit plans of an AI app (Raven): catalogue and views. Mirrors analytics/novaPlans.js for Nova.
 * A plan is a price; the credit it buys comes from the volume-discount rule (apps/pricing.js).
 */
import AppPlan from './models/AppPlan.js';
import { loadAppPlanContext, quoteForPrice, toCustomerQuote } from './pricing.js';

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const cleanFeatures = (list) =>
  (Array.isArray(list) ? list : String(list || '').split('\n')).map((f) => String(f).trim().slice(0, 120)).filter(Boolean).slice(0, 12);

/** Staff view: price, the credit it buys, bonus, what it covers in Anthropic usage and the margin. */
export function toAdminPlan(doc, ctx) {
  const q = quoteForPrice(doc.price_usd, ctx.settings, ctx.markup);
  return {
    app: doc.app,
    plan_id: doc.plan_id,
    name: doc.name,
    description: doc.description || '',
    features: doc.features || [],
    price_usd: doc.price_usd,
    credit_usd: q.credit_usd,
    bonus_pct: q.bonus_pct,
    margin_rate: q.margin_rate,
    anthropic_value_usd: q.anthropic_value_usd,
    margin_usd: q.margin_usd,
    estimated_requests: q.estimated_requests,
    active: Boolean(doc.active),
    sort: doc.sort ?? 0,
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

/** Customer view: what they pay, what they receive and what is included. Never Anthropic's cost or the margin. */
export function toCustomerPlan(doc, ctx) {
  return { plan_id: doc.plan_id, name: doc.name, description: doc.description || '', features: doc.features || [], ...toCustomerQuote(quoteForPrice(doc.price_usd, ctx.settings, ctx.markup)) };
}

export const listPlans = (app, { activeOnly = false } = {}) =>
  AppPlan.find({ app, ...(activeOnly ? { active: true } : {}) }).sort({ sort: 1, price_usd: 1 }).lean();

export async function getPlan(app, planId) {
  const id = slug(planId);
  return id ? AppPlan.findOne({ app, plan_id: id }).lean() : null;
}

export async function savePlan(app, body = {}, { create = false } = {}) {
  const planId = slug(body.plan_id || body.name);
  if (!planId) throw new Error('plan_id or name is required');
  const existing = await AppPlan.findOne({ app, plan_id: planId }).lean();
  if (create && existing) throw new Error(`plan_id "${planId}" already exists`);
  if (!create && !existing) throw new Error(`plan "${planId}" not found`);
  const name = body.name !== undefined ? String(body.name).trim() : existing?.name;
  if (!name) throw new Error('name is required');
  const price = body.price_usd !== undefined ? Number(body.price_usd) : existing?.price_usd;
  if (!Number.isFinite(price) || price <= 0) throw new Error('price_usd must be a positive number');
  const now = new Date();
  const doc = await AppPlan.findOneAndUpdate(
    { app, plan_id: planId },
    {
      $set: {
        app,
        plan_id: planId,
        name,
        description: body.description !== undefined ? String(body.description).slice(0, 500) : (existing?.description || ''),
        features: body.features !== undefined ? cleanFeatures(body.features) : (existing?.features || []),
        price_usd: Math.round(price * 100) / 100,
        active: body.active !== undefined ? Boolean(body.active) : (existing ? existing.active : true),
        sort: body.sort !== undefined ? Number(body.sort) || 0 : (existing?.sort ?? 0),
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true, new: true },
  ).lean();
  return toAdminPlan(doc, await loadAppPlanContext(app));
}

/** First boot only (no plan for this app): a default catalogue. Staff edit or hide these in the admin dashboard. */
export async function ensureDefaultPlans(app) {
  if ((await AppPlan.countDocuments({ app })) > 0) return 0;
  const common = ['Works on every mailbox your team connects', 'Usage by day in the admin dashboard'];
  const defaults = {
    raven: [
      { plan_id: 'starter', name: 'Raven Starter', description: 'For trying Raven on a small team.', price_usd: 20, sort: 1, features: ['Summaries, categories and priority on new mail', ...common] },
      { plan_id: 'growth', name: 'Raven Growth', description: 'Everyday mail for a growing team.', price_usd: 100, sort: 2, features: ['Re-analyse any older mail on demand', ...common] },
      { plan_id: 'scale', name: 'Raven Scale', description: 'High mail volume across many mailboxes.', price_usd: 500, sort: 3, features: ['The largest bonus credit', ...common] },
    ],
  }[app] || [];
  for (const plan of defaults) await savePlan(app, plan, { create: true });
  return defaults.length;
}
