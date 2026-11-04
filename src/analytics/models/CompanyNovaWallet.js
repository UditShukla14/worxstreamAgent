/**
 * Per-company Nova USD wallet — free allowance + purchased credits − spent.
 * No document ⇒ unlimited (enforcement off until ops sets an allowance).
 */

import mongoose from 'mongoose';

const companyNovaWalletSchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true, unique: true, index: true },
    /** When true, remaining_usd is enforced (set when ops configures an allowance or grants credits). */
    limits_enabled: { type: Boolean, default: false },
    free_allowance_usd: { type: Number, default: 0, min: 0 },
    purchased_credit_usd: { type: Number, default: 0, min: 0 },
    spent_usd: { type: Number, default: 0, min: 0 },
    /** Company default models for daily / medium / hard / advanced Nova tasks. */
    model_tiers: {
      type: {
        daily: { type: String, default: '' },
        medium: { type: String, default: '' },
        hard: { type: String, default: '' },
        advanced: { type: String, default: '' },
      },
      default: () => ({}),
    },
    notes: { type: String, default: '' },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: 'company_nova_wallets',
    timestamps: false,
  },
);

const CompanyNovaWallet =
  mongoose.models.CompanyNovaWallet
  || mongoose.model('CompanyNovaWallet', companyNovaWalletSchema);

export default CompanyNovaWallet;
