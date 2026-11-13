import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceNumber, isInvoiceable, renderInvoiceHtml } from '../../src/billing/invoice.js';

const tx = { id: '65f0c0ffee0123456789abcd', type: 'grant', created_at: '2026-11-13T10:00:00Z', plan_name: 'Nova <Growth>', paid_usd: 250, amount_usd: 254.24, payment_ref: 'pi_123' };

test('invoice number is stable and dated', () => {
  assert.equal(invoiceNumber(tx), 'WX-20261113-89ABCD');
});

test('only paid grants are invoiceable', () => {
  assert.equal(isInvoiceable(tx), true);
  assert.equal(isInvoiceable({ ...tx, paid_usd: null }), false);
  assert.equal(isInvoiceable({ ...tx, type: 'reversal' }), false);
  assert.equal(isInvoiceable(null), false);
});

test('invoice shows the amounts and escapes user-controlled text', () => {
  const html = renderInvoiceHtml(tx, { company_id: 'c1', company_name: '<script>x</script>' }, { name: 'Worxstream', address: 'A|B', tax_id: '' });
  assert.match(html, /\$250\.00/);
  assert.match(html, /\$254\.24/);
  assert.match(html, /includes \$4\.24 bonus/);
  assert.match(html, /Nova &lt;Growth&gt;/);
  assert.doesNotMatch(html, /<script>x/);
});
