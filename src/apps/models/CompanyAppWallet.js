/**
 * Credit wallet of one AI app (Raven) for one company: free allowance + purchased credit - spent, in integer micro-USD
 * of billable dollars. Same rules as the Nova wallet (analytics/novaWallet.js), one document per (company, app).
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    company_id: { type: String, required: true },
    app: { type: String, required: true, enum: ['raven'] },
    /** Enforced once an allowance is set or credit is granted; no wallet or not enforced = unlimited. */
    limits_enabled: { type: Boolean, default: false },
    free_allowance_micros: { type: Number, default: 0, min: 0 },
    purchased_credit_micros: { type: Number, default: 0 },
    spent_micros: { type: Number, default: 0, min: 0 },
    /** Per-company markup override (null = the app's default). Staff only. */
    markup_rate: { type: Number, default: null, min: 0 },
    notes: { type: String, default: '' },
    /** The credit total (micros) the 80%-used email was last sent for; adding credit changes the total and so re-arms it. */
    usage_alert_granted_micros: { type: Number, default: null },
    usage_alert_at: { type: Date, default: null },
    grant_refs: { type: [String], default: undefined, select: false },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'company_app_wallets', timestamps: false },
);
schema.index({ company_id: 1, app: 1 }, { unique: true });

export default mongoose.models.CompanyAppWallet || mongoose.model('CompanyAppWallet', schema);
