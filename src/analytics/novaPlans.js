/**
 * Nova credit plans: pricing rule, catalog and customer view.
 * Price = Anthropic credit x (1 + margin), rounded to the cent. The company is credited the full `credit_usd`.
 */

import NovaPlan from './models/NovaPlan.js';
import { config } from '../config/index.js';

/** Dollars to charge for `creditUsd` of Anthropic usage with `marginRate` on top, rounded to the cent. */
export function priceForCredit(creditUsd, marginRate) {
  const credit = Number(creditUsd);
  const margin = Number(marginRate);
  if (!Number.isFinite(credit) || credit <= 0) throw new Error('credit_usd must be a positive number');
  if (!Number.isFinite(margin) || margin < 0 || margin > 5) throw new Error('margin_rate must be between 0 and 5 (0.2 = +20%)');
  return Math.round(credit * 100 * (1 + margin)) / 100;
}

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Staff view: includes the margin and inactive plans. */
export function toAdminPlan(doc) {
  return {
    plan_id: doc.plan_id,
    name: doc.name,
    description: doc.description || '',
    credit_usd: doc.credit_usd,
    margin_rate: doc.margin_rate,
    price_usd: doc.price_usd,
    active: Boolean(doc.active),
    sort: doc.sort ?? 0,
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

/** Customer view: what they pay and what they get. Never the margin. */
export function toCustomerPlan(doc) {
  return {
    plan_id: doc.plan_id,
    name: doc.name,
    description: doc.description || '',
    credit_usd: doc.credit_usd,
    price_usd: doc.price_usd,
  };
}

export async function listNovaPlans({ activeOnly = false } = {}) {
  const docs = await NovaPlan.find(activeOnly ? { active: true } : {}).sort({ sort: 1, credit_usd: 1 }).lean();
  return docs;
}

export async function getNovaPlan(planId) {
  const id = slug(planId);
  if (!id) return null;
  return NovaPlan.findOne({ plan_id: id }).lean();
}

/**
 * Create or update a plan. price_usd is always recomputed from credit and margin, so it cannot drift.
 * @param {{ plan_id?: string, name?: string, description?: string, credit_usd?: number, margin_rate?: number, active?: boolean, sort?: number }} body
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
  const credit = body.credit_usd !== undefined ? Number(body.credit_usd) : existing?.credit_usd;
  const margin = body.margin_rate !== undefined && body.margin_rate !== null && body.margin_rate !== ''
    ? Number(body.margin_rate)
    : (existing?.margin_rate ?? config.billing?.planMarginRate ?? 0.2);
  const price = priceForCredit(credit, margin);

  const now = new Date();
  const doc = await NovaPlan.findOneAndUpdate(
    { plan_id: planId },
    {
      $set: {
        plan_id: planId,
        name,
        description: body.description !== undefined ? String(body.description).slice(0, 500) : (existing?.description || ''),
        credit_usd: Math.round(credit * 100) / 100,
        margin_rate: margin,
        price_usd: price,
        active: body.active !== undefined ? Boolean(body.active) : (existing ? existing.active : true),
        sort: body.sort !== undefined ? Number(body.sort) || 0 : (existing?.sort ?? 0),
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true, new: true },
  ).lean();
  return toAdminPlan(doc);
}

/** First boot only (no plans at all): the default catalogue. Staff edit or deactivate these in the admin dashboard. */
export async function ensureDefaultNovaPlans() {
  if ((await NovaPlan.estimatedDocumentCount()) > 0) return 0;
  const defaults = [
    { plan_id: 'starter', name: 'Nova Starter', description: 'Light use for a small team.', credit_usd: 50, sort: 1 },
    { plan_id: 'growth', name: 'Nova Growth', description: 'Everyday use across a team.', credit_usd: 250, sort: 2 },
    { plan_id: 'scale', name: 'Nova Scale', description: 'Heavy use, many employees.', credit_usd: 1000, sort: 3 },
  ];
  for (const plan of defaults) await saveNovaPlan(plan, { create: true });
  return defaults.length;
}
