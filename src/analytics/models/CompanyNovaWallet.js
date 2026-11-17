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
    /**
     * Integer micro-USD (1 USD = 1_000_000) — AUTHORITATIVE money fields. Billable (customer-facing) dollars.
     * All writes go through novaWallet.js atomic update pipelines.
     */
    free_allowance_micros: { type: Number, default: 0, min: 0 },
    purchased_credit_micros: { type: Number, default: 0, min: 0 },
    spent_micros: { type: Number, default: 0, min: 0 },
    /** Derived USD mirrors (always recomputed from micros in the same atomic write). */
    free_allowance_usd: { type: Number, default: 0, min: 0 },
    purchased_credit_usd: { type: Number, default: 0, min: 0 },
    spent_usd: { type: Number, default: 0, min: 0 },
    /** Admin-assigned label shown in the ops dashboard (company names live in Laravel, not here). */
    display_name: { type: String, default: '' },
    /** Plan label shown to the company (admin-set), e.g. "Pro" or "Enterprise". */
    plan_name: { type: String, default: '' },
    /** Employees on the company's Worxstream plan (admin-set) → adoption % = active employees / seats. */
    seats: { type: Number, default: null, min: 0 },
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
    /** Per-company markup override (null = use NOVA_MARKUP_RATE). Admin-only; never shown to the customer. */
    markup_rate: { type: Number, default: null, min: 0 },
    notes: { type: String, default: '' },
    /** Payment references already credited (most recent 500) — makes grants idempotent. Never sent to clients. */
    grant_refs: { type: [String], default: undefined, select: false },
    /** Credit held for turns that are running right now ({ id, micros, expires_at }); see reserveCredit. Never sent to clients. */
    holds: { type: [mongoose.Schema.Types.Mixed], default: undefined, select: false },
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
