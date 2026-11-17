/**
 * Chargebacks (Stripe disputes) on Nova credit purchases.
 *
 * Standard process for prepaid credit:
 *  - dispute opened (`charge.dispute.created`): Stripe has already pulled the money back, so take the credit back at once
 *    (what the company has not spent is gone; the rest shows as a negative balance). Inquiries (`warning_*`) move no money
 *    and are ignored.
 *  - dispute closed (`charge.dispute.closed`): WON (or a warning closed) -> give the credit back; LOST -> nothing more to do.
 *  - staff answer the dispute with evidence in the Stripe dashboard within Stripe's deadline (usage history is in the
 *    admin dashboard).
 * Every step is idempotent per dispute id, so Stripe retries are harmless.
 */

import WalletTransaction from '../../analytics/models/WalletTransaction.js';
import { grantWalletCredits, reverseWalletCredit } from '../../analytics/novaWallet.js';
import { grantAppCredits, reverseAppCredit } from '../../apps/appWallet.js';

const paymentIntentId = (dispute) => (typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id || '');
const reversalRef = (dispute) => `dispute:${dispute.id}`;
const restoreRef = (dispute) => `dispute_won:${dispute.id}`;

/** The credit grant a Nova payment produced, or null when the payment was not a Nova credit purchase. */
async function findGrant(dispute) {
  const pi = paymentIntentId(dispute);
  if (!pi) return null;
  return WalletTransaction.findOne({ payment_ref: pi, type: 'grant' }).lean();
}

/** @returns {Promise<{ handled: boolean, reason?: string }>} */
export async function handleDisputeCreated(dispute) {
  if (String(dispute.status || '').startsWith('warning_')) return { handled: false, reason: 'inquiry, no money moved' };
  const grant = await findGrant(dispute);
  if (!grant) return { handled: false, reason: 'not a Nova credit payment' };

  // Disputed share of the payment (a partial dispute takes back the same share of the credit).
  const paid = grant.paid_micros ? grant.paid_micros / 1e6 : 0;
  const disputed = (dispute.amount ?? 0) / 100;
  const share = paid > 0 ? Math.min(1, disputed / paid) : 1;
  const micros = Math.round(grant.amount_micros * share);
  if (micros <= 0) return { handled: false, reason: 'nothing to take back' };

  const reverse = grant.app && grant.app !== 'nova' ? (c, o) => reverseAppCredit(c, grant.app, o) : reverseWalletCredit;
  const out = await reverse(grant.company_id, {
    amount_micros: micros,
    ref: reversalRef(dispute),
    reason: 'Payment disputed with the bank',
    actor: 'stripe',
  });
  return { handled: out.reversed, reason: out.duplicate ? 'already applied' : undefined };
}

/** @returns {Promise<{ handled: boolean, reason?: string }>} */
export async function handleDisputeClosed(dispute) {
  if (!['won', 'warning_closed'].includes(dispute.status)) return { handled: false, reason: `dispute ${dispute.status}: credit stays removed` };
  const reversal = await WalletTransaction.findOne({ payment_ref: reversalRef(dispute), type: 'reversal' }).lean();
  if (!reversal) return { handled: false, reason: 'no credit was taken back' };

  const restore = reversal.app && reversal.app !== 'nova' ? (c, b) => grantAppCredits(c, reversal.app, b) : grantWalletCredits;
  const out = await restore(reversal.company_id, {
    amount_usd: Math.abs(reversal.amount_micros) / 1e6,
    payment_ref: restoreRef(dispute),
    reason: 'Dispute won: credit restored',
    actor: 'stripe',
  });
  return { handled: !out.duplicate, reason: out.duplicate ? 'already applied' : undefined };
}
