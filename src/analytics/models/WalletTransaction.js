/**
 * Wallet transaction history: one row per event that changes what a company can spend
 * (credit purchases/grants, trial allowance, allowance changes, ledger reconciliation).
 * The wallet document holds the balance; this is the audit trail and the customer's history.
 * Spend is not repeated here — every Claude call is already a row in llm_usage_events.
 */

import mongoose from 'mongoose';

export const WALLET_TX_TYPES = ['grant', 'trial', 'allowance_set', 'reconcile', 'reversal'];

const walletTransactionSchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true, index: true },
    /** Which AI app's wallet this row belongs to. Rows from before the field existed are Nova's. */
    app: { type: String, default: 'nova' },
    type: { type: String, enum: WALLET_TX_TYPES, required: true },
    /** Integer micro-USD that this event added to what the company can spend (can be negative for reconcile). */
    amount_micros: { type: Number, required: true },
    amount_usd: { type: Number, required: true },
    /** Remaining balance right after the event (integer micro-USD) when known. */
    balance_after_micros: { type: Number, default: null },
    /** Nova plan bought (snapshot of the name at purchase time) and the cash the company paid for it. */
    plan_id: { type: String, default: '' },
    plan_name: { type: String, default: '' },
    paid_micros: { type: Number, default: null },
    reason: { type: String, default: '' },
    /** Payment reference (e.g. Stripe PaymentIntent id) for purchases; identical refs never credit twice. */
    payment_ref: { type: String, default: '' },
    actor: { type: String, default: 'system' }, // 'stripe' | 'admin' | 'system'
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'nova_wallet_transactions', timestamps: false },
);

walletTransactionSchema.index({ company_id: 1, created_at: -1 });
// Find the grant behind a Stripe payment (disputes arrive with the PaymentIntent id only).
walletTransactionSchema.index({ payment_ref: 1 }, { partialFilterExpression: { payment_ref: { $type: 'string', $gt: '' } } });
// One ledger row per payment reference per company (partial: only rows that carry a reference).
walletTransactionSchema.index(
  { company_id: 1, payment_ref: 1 },
  { unique: true, partialFilterExpression: { payment_ref: { $type: 'string', $gt: '' } } },
);

const WalletTransaction =
  mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);

export default WalletTransaction;
