/**
 * Nova credit plans: catalogue and views.
 * A plan is a price. The company pays `price_usd`; the credit it receives comes from the volume-discount rule
 * (novaPricing.js): the same amount for small plans, a little more (bonus credit) for larger ones. Worxstream's margin is
 * taken as the credit is spent.
 */

import NovaPlan from './models/NovaPlan.js';
import { config } from '../config/index.js';
import { getPricingSettings, quoteForPrice, toCustomerQuote } from './novaPricing.js';

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const cleanFeatures = (list) =>
  (Array.isArray(list) ? list : String(list || '').split('\n'))
    .map((f) => String(f).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 12);

/** Staff view: price, the credit it buys, bonus, what it covers in Anthropic usage and the margin. */
export function toAdminPlan(doc, ctx = {}) {
  const q = quoteForPrice(doc.price_usd, ctx.settings, ctx.markup);
  return {
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
export function toCustomerPlan(doc, ctx = {}) {
  const q = toCustomerQuote(quoteForPrice(doc.price_usd, ctx.settings, ctx.markup));
  return {
    plan_id: doc.plan_id,
    name: doc.name,
    description: doc.description || '',
    features: doc.features || [],
    ...q,
  };
}

export async function listNovaPlans({ activeOnly = false } = {}) {
  return NovaPlan.find(activeOnly ? { active: true } : {}).sort({ sort: 1, price_usd: 1 }).lean();
}

export async function getNovaPlan(planId) {
  const id = slug(planId);
  if (!id) return null;
  return NovaPlan.findOne({ plan_id: id }).lean();
}

/** Plans, pricing settings and markup together, so a view is built from one consistent snapshot. */
export async function loadPlanContext() {
  return { settings: await getPricingSettings(), markup: config.billing?.markupRate ?? 0 };
}

/**
 * Create or update a plan.
 * @param {{ plan_id?: string, name?: string, description?: string, features?: string[]|string, price_usd?: number, active?: boolean, sort?: number }} body
 * @param {{ create?: boolean }} [opts]
 */
export async function saveNovaPlan(body = {}, { create = false } = {}) {
  const planId = slug(body.plan_id || body.name);
  if (!planId) throw new Error('plan_id or name is required');
  const existing = await NovaPlan.findOne({ plan_id: planId }).lean();
  if (create && existing) throw new Error(`plan_id "${planId}" already exists`);
  if (!create && !existing) throw new Error(`plan "${planId}" not found`);

  const name = body.name !== undefined ? String(body.name).trim() : existing?.name;
  if (!name) throw new Error('name is required');
  const price = body.price_usd !== undefined ? Number(body.price_usd) : existing?.price_usd;
  if (!Number.isFinite(price) || price <= 0) throw new Error('price_usd must be a positive number');

  const now = new Date();
  const doc = await NovaPlan.findOneAndUpdate(
    { plan_id: planId },
    {
      $set: {
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
  return toAdminPlan(doc, await loadPlanContext());
}

/**
 * Plans saved by the earlier design had `credit_usd` (Anthropic value) and `margin_rate`, with the price derived from them.
 * A plan is now just a price (what the company pays), so keep the credit figure as the price (50 / 250 / 1000 for the
 * defaults) and drop the old fields. Safe to run at every boot: only plans that still carry the old fields are touched.
 * @returns {Promise<number>} plans converted
 */
export async function migrateLegacyNovaPlans() {
  const res = await NovaPlan.collection.updateMany(
    { credit_usd: { $exists: true } },
    [{ $set: { price_usd: '$credit_usd', updated_at: '$$NOW' } }, { $unset: ['credit_usd', 'margin_rate'] }],
  );
  return res.modifiedCount || 0;
}

/** First boot only (no plans at all): the default catalogue. Staff edit or hide these in the admin dashboard. */
export async function ensureDefaultNovaPlans() {
  if ((await NovaPlan.estimatedDocumentCount()) > 0) return 0;
  const common = ['Works across all your Worxstream apps', 'Usage reports by employee and by day'];
  const defaults = [
    { plan_id: 'starter', name: 'Nova Starter', description: 'For trying Nova with a small team.', price_usd: 50, sort: 1,
      features: ['Everyday questions, summaries and reports', ...common] },
    { plan_id: 'growth', name: 'Nova Growth', description: 'Everyday use across your team.', price_usd: 250, sort: 2,
      features: ['Reports, estimates and invoices on demand', 'Choose the AI model for each task', ...common] },
    { plan_id: 'scale', name: 'Nova Scale', description: 'Heavy use across many employees.', price_usd: 1000, sort: 3,
      features: ['The largest bonus credit', 'Choose the AI model for each task', ...common] },
  ];
  for (const plan of defaults) await saveNovaPlan(plan, { create: true });
  return defaults.length;
}
