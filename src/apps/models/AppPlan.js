/**
 * Credit plans of an AI app other than Nova (Raven today). Same idea as Nova's plans (analytics/models/NovaPlan.js): a plan is a
 * PRICE. The company pays `price_usd` and receives that much credit (plus any volume bonus, see apps/pricing.js) in the app's
 * own wallet. One collection for every such app, told apart by `app`.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    app: { type: String, required: true, enum: ['raven'] },
    /** Stable slug used by the web app, e.g. "starter". Unique within an app. */
    plan_id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price_usd: { type: Number, required: true, min: 0.01 },
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'app_plans', timestamps: false },
);
schema.index({ app: 1, plan_id: 1 }, { unique: true });

export default mongoose.models.AppPlan || mongoose.model('AppPlan', schema);
