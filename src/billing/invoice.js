/**
 * Printable invoice for a Nova credit purchase. A standalone HTML page (no scripts from outside, nothing to install):
 * the browser's "Save as PDF" in the print dialog gives the downloadable file. Every value is HTML-escaped.
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
  const sellerLines = [seller.address, seller.tax_id ? `Tax ID: ${seller.tax_id}` : ''].filter(Boolean).flatMap((l) => String(l).split('|'));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(number)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f3f4f6;color:#111827;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .bar{max-width:820px;margin:20px auto 0;display:flex;justify-content:flex-end}
  .bar button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}
  .page{max-width:820px;margin:12px auto 40px;background:#fff;border-radius:12px;padding:48px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
  h1{margin:0;font-size:28px;letter-spacing:-.02em} .muted{color:#6b7280} .small{font-size:12px}
  .badge{display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:32px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:32px} th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;padding:8px 0;border-bottom:1px solid #e5e7eb}
  td{padding:14px 0;border-bottom:1px solid #f3f4f6;vertical-align:top} .r{text-align:right}
  .totals{margin:20px 0 0 auto;width:320px} .totals div{display:flex;justify-content:space-between;padding:5px 0}
  .totals .due{border-top:1px solid #e5e7eb;margin-top:6px;padding-top:12px;font-size:16px;font-weight:700}
  .foot{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb}
  @media print{body{background:#fff}.bar{display:none}.page{box-shadow:none;margin:0;padding:0;max-width:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Download PDF</button></div>
<div class="page">
  <div class="top">
    <div><h1>Invoice</h1><div class="muted">${esc(number)}</div></div>
    <div style="text-align:right"><div style="font-weight:700;font-size:16px">${esc(seller.name)}</div>${sellerLines.map((l) => `<div class="muted small">${esc(l)}</div>`).join('')}</div>
  </div>
  <div class="grid">
    <div><div class="label">Billed to</div><div style="font-weight:600">${esc(buyer.company_name || `Company ${buyer.company_id}`)}</div><div class="muted small">Company ID ${esc(buyer.company_id)}</div></div>
    <div>
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
