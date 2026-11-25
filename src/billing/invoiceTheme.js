/**
 * Shared look of Worxstream's printable invoices: the logo (from worxstream-platform's public/worxstream-logo.svg, inlined so the
 * page is standalone) and styles that follow the web app (Nunito, primary blue #2196f3 / #1565c0, #e5e7eb borders, #f1f5f9 panels).
 */

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 412.52 461.22" width="40" height="45" role="img" aria-label="Worxstream"><g fill="#111827"><polygon points="285.77,240.19 169.88,239.63 7.97,9.55 128.97,9.55"/><polygon points="403.86,415.43 286.74,415.43 244.86,349.83 302.81,265.76"/></g><g fill="#086BB5"><polygon points="303.95,215.39 294.48,202.13 375.52,82.83 394.46,82.83"/><polygon points="285.17,190.36 273.86,174.75 336.52,82.83 358.29,82.83"/><polygon points="264.94,163.88 253.28,146.76 297.13,82.83 320.99,82.83"/><polygon points="144.79,450.95 126.13,450.95 247.99,265.47 269.96,265.47"/><polygon points="108.14,450.95 84.38,450.95 208.98,265.47 229.24,265.47"/><polygon points="66.48,450.95 42.06,450.95 169.59,265.47 192.69,265.47"/></g></svg>`;

export const INVOICE_CSS = `
  :root{--primary:#2196f3;--primary-text:#1565c0;--primary-light:#eaf1ff;--border:#e5e7eb;--panel:#f1f5f9;--text:#0f172a;--muted:#64748b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--panel);color:var(--text);font:14px/1.55 "Nunito",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .bar{max-width:820px;margin:20px auto 0;display:flex;justify-content:flex-end}
  .bar button{background:var(--primary);color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}
  .bar button:hover{background:#1976d2}
  .page{max-width:820px;margin:12px auto 40px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:48px;overflow:hidden;position:relative}
  .page:before{content:"";position:absolute;left:0;right:0;top:0;height:5px;background:var(--primary)}
  .top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
  .brand{display:flex;align-items:center;gap:12px}
  .brand .name{font-weight:800;font-size:20px;letter-spacing:-.01em}
  h1{margin:28px 0 2px;font-size:30px;font-weight:800;letter-spacing:-.02em;color:var(--primary-text)}
  .muted{color:var(--muted)} .small{font-size:12px} .r{text-align:right} .num{font-variant-numeric:tabular-nums}
  .seller{text-align:right}
  .badge{display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px}
  .box{background:var(--panel);border-radius:10px;padding:16px 18px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:28px}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--primary-text);background:var(--primary-light);text-align:left;padding:10px 12px;font-weight:700}
  th.r{text-align:right} th:first-child{border-radius:8px 0 0 8px} th:last-child{border-radius:0 8px 8px 0}
  td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  tr{page-break-inside:avoid}
  tfoot td{border-bottom:0;background:var(--primary-light);color:var(--primary-text);font-weight:800;font-size:15px}
  tfoot td:first-child{border-radius:8px 0 0 8px} tfoot td:last-child{border-radius:0 8px 8px 0}
  .totals{margin:20px 0 0 auto;width:340px} .totals div{display:flex;justify-content:space-between;padding:5px 12px}
  .totals .due{background:var(--primary-light);color:var(--primary-text);border-radius:8px;margin-top:8px;padding:12px;font-size:17px;font-weight:800}
  .foot{margin-top:40px;padding-top:16px;border-top:1px solid var(--border)}
  @media print{body{background:#fff}.bar{display:none}.page{border:0;border-radius:0;margin:0;padding:24px 0 0;max-width:none}}
`;

/** Document head up to and including the Download button; pair with {@link invoiceHeader}. */
export function invoiceHead(title) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${INVOICE_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Download PDF</button></div>`;
}

/** Logo and company block, then the document title and number. */
export function invoiceHeader({ seller, title, number }) {
  const lines = [seller.address, seller.tax_id ? `Tax ID: ${seller.tax_id}` : ''].filter(Boolean).flatMap((l) => String(l).split('|'));
  return `<div class="top">
    <div class="brand">${LOGO_SVG}<span class="name">${esc(seller.name)}</span></div>
    <div class="seller">${lines.map((l) => `<div class="muted small">${esc(l)}</div>`).join('')}</div>
  </div>
  <h1>${esc(title)}</h1><div class="muted">${esc(number)}</div>`;
}
