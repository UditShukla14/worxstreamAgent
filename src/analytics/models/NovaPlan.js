/**
 * Nova credit plans: what a company can buy for the Nova app. SEPARATE from the Worxstream app subscription plans
 * (those are for the apps a company subscribes to). A plan sells `credit_usd` of Anthropic usage for
 * `price_usd` = credit x (1 + margin_rate). Managed by Worxstream staff in the admin dashboard.
 */

import mongoose from 'mongoose';

const novaPlanSchema = new mongoose.Schema(
  {
    /** Stable slug used by the web app and by Laravel when it prices a payment, e.g. "growth". */
    plan_id: { type: String, required: true, unique: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** Anthropic-cost value credited to the company's wallet. */
    credit_usd: { type: Number, required: true, min: 0.01 },
    /** Margin on top of the credit (0.2 = +20%). */
    margin_rate: { type: Number, required: true, min: 0, max: 5 },
    /** What the company pays, in dollars, always credit x (1 + margin) rounded to the cent. */
    price_usd: { type: Number, required: true, min: 0.01 },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'nova_plans', timestamps: false },
);

const NovaPlan = mongoose.models.NovaPlan || mongoose.model('NovaPlan', novaPlanSchema);
export default NovaPlan;
