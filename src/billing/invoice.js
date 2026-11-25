/**
 * Printable invoice for a Nova credit purchase. A standalone HTML page (no scripts from outside, nothing to install):
 * the browser's "Save as PDF" in the print dialog gives the downloadable file. Every value is HTML-escaped.
 */

import { renderInvoiceDocument, esc } from './invoiceTheme.js';
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
const dateLong = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Stable, human-readable number derived from the ledger row. */
export function invoiceNumber(tx) {
  const d = new Date(tx.created_at);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `WX-${ymd}-${String(tx.id).slice(-6).toUpperCase()}`;
}

/** Only a real payment is invoiceable: a grant that records what the company paid. */
export function isInvoiceable(tx) {
  return Boolean(tx) && tx.type === 'grant' && tx.paid_usd != null && tx.paid_usd > 0;
}

/**
 * @param {{ id: string, created_at: string, plan_name?: string, paid_usd: number, amount_usd: number, payment_ref?: string }} tx customer-safe wallet row
 * @param {{ company_id: string, company_name?: string }} buyer
 * @param {{ name: string, address?: string, tax_id?: string }} seller
 */
export function renderInvoiceHtml(tx, buyer, seller) {
  const number = invoiceNumber(tx);
  const bonus = Math.max(0, tx.amount_usd - tx.paid_usd);
  const paid = esc(usd(tx.paid_usd));
  const date = dateLong(tx.created_at);
  const body = `
  <table class="items">
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
    <tbody><tr>
      <td><div style="font-weight:600">${esc(tx.plan_name || 'Nova credit')}</div><div class="muted small">AI credit, one-time purchase. Credit received: ${esc(usd(tx.amount_usd))}${bonus > 0.004 ? ` (includes ${esc(usd(bonus))} bonus)` : ''}</div></td>
      <td class="r num">1</td><td class="r num">${paid}</td><td class="r num">${paid}</td>
    </tr></tbody>
    <tfoot>
      <tr><td colspan="2"></td><td class="l">Subtotal</td><td class="r num">${paid}</td></tr>
      <tr><td colspan="2"></td><td class="l">Total</td><td class="r num">${paid}</td></tr>
      <tr class="strong"><td colspan="2"></td><td class="l">Amount paid</td><td class="r num">${paid}</td></tr>
    </tfoot>
  </table>`;
  return renderInvoiceDocument({
    title: 'Invoice', number, seller, billTo: { name: buyer.company_name || `Company ${buyer.company_id}`, id: buyer.company_id },
    issued: date, due: date,
    headline: `${paid} <span class="badge">Paid</span>`, body,
    note: `${tx.payment_ref ? `Payment reference: ${esc(tx.payment_ref)}. ` : ''}Paid by card through Stripe. AI credit is non-refundable and is used by everyone in your company.`,
  });
}
