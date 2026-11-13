/**
 * Nova credit plans: what a company can buy for the Nova app. SEPARATE from the Worxstream app subscription plans
 * (those are for the apps a company subscribes to). A plan is a PRICE: the company pays `price_usd` and receives the same
 * amount as Nova credit. Worxstream's margin is taken when the credit is spent (the per-request markup), so a company only
 * ever sees the dollars it is charged. Managed by Worxstream staff in the admin dashboard.
 */

import mongoose from 'mongoose';

const novaPlanSchema = new mongoose.Schema(
  {
    /** Stable slug used by the web app and by Laravel when it prices a payment, e.g. "growth". */
    plan_id: { type: String, required: true, unique: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** What the company pays, and the Nova credit it receives, in dollars. */
    price_usd: { type: Number, required: true, min: 0.01 },
    /** What the plan includes, shown as bullet points on the pricing card. */
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'nova_plans', timestamps: false },
);

const NovaPlan = mongoose.models.NovaPlan || mongoose.model('NovaPlan', novaPlanSchema);
export default NovaPlan;
