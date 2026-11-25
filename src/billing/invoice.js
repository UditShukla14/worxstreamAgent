/**
 * Printable invoice for a Nova credit purchase. A standalone HTML page (no scripts from outside, nothing to install):
 * the browser's "Save as PDF" in the print dialog gives the downloadable file. Every value is HTML-escaped.
 */

import { invoiceHead, invoiceHeader, esc } from './invoiceTheme.js';
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
  return `${invoiceHead(`Invoice ${number}`)}
<div class="page">
  ${invoiceHeader({ seller: seller, title: 'Invoice', number: number })}
  <div class="grid">
    <div class="box"><div class="label">Billed to</div><div style="font-weight:600">${esc(buyer.company_name || `Company ${buyer.company_id}`)}</div><div class="muted small">Company ID ${esc(buyer.company_id)}</div></div>
    <div class="box">
      <div class="label">Details</div>
      <div>Invoice date: ${esc(dateLong(tx.created_at))}</div>
      <div>Status: <span class="badge">Paid</span></div>
      ${tx.payment_ref ? `<div class="muted small">Payment reference: ${esc(tx.payment_ref)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="r">Nova credit</th><th class="r">Amount</th></tr></thead>
    <tbody><tr>
      <td><div style="font-weight:600">${esc(tx.plan_name || 'Nova credit')}</div><div class="muted small">Nova AI credit, one-time purchase</div></td>
      <td class="r">${esc(usd(tx.amount_usd))}${bonus > 0.004 ? `<div class="muted small">includes ${esc(usd(bonus))} bonus</div>` : ''}</td>
      <td class="r">${esc(usd(tx.paid_usd))}</td>
    </tr></tbody>
  </table>
  <div class="totals">
    <div><span class="muted">Subtotal</span><span>${esc(usd(tx.paid_usd))}</span></div>
    <div class="due"><span>Total paid (USD)</span><span>${esc(usd(tx.paid_usd))}</span></div>
  </div>
  <div class="foot muted small">Paid by card through Stripe. Nova credit is non-refundable and is used by everyone in your company. Thank you for your business.</div>
</div>
</body></html>`;
}
