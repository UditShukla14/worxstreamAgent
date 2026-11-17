/**
 * Which AI apps a company has chosen, and whether each is switched on. One row per (company, app).
 * No row for Nova = Nova works as it always has (existing companies are not locked out); Raven needs an active row.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    company_id: { type: String, required: true },
    app: { type: String, required: true, enum: ['nova', 'raven'] },
    status: { type: String, required: true, enum: ['active', 'paused', 'off'], default: 'active' },
    /** Admin-set label shown to the company, e.g. "Pro". */
    plan_name: { type: String, default: '' },
    notes: { type: String, default: '' },
    activated_at: { type: Date, default: null },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'company_app_subscriptions', timestamps: false },
);
schema.index({ company_id: 1, app: 1 }, { unique: true });
schema.index({ app: 1, status: 1 });

export default mongoose.models.CompanyAppSubscription || mongoose.model('CompanyAppSubscription', schema);
