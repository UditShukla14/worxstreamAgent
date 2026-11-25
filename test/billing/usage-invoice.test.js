import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { foldInvoiceDays, renderUsageInvoiceHtml, usageInvoiceNumber } = await import('../../src/billing/usageInvoice.js');
const { compareDaily } = await import('../../src/analytics/anthropicReconcile.js');

describe('usage invoice', () => {
  const rows = [
    { date: '2026-11-02', agent_key: 'nova-chat', call_count: 2, billable_micros: 1_200_000 },
    { date: '2026-11-02', agent_key: 'raven', call_count: 1, billable_micros: 300_000 },
    { date: '2026-11-01', agent_key: 'nova-chat', call_count: 1, billable_micros: 600_000 },
  ];

  it('folds rows into sorted days split by Nova and Raven', () => {
    const { days, totals } = foldInvoiceDays(rows);
    assert.deepEqual(days.map((d) => d.date), ['2026-11-01', '2026-11-02']);
    assert.equal(days[1].nova_usd, 1.2);
    assert.equal(days[1].raven_usd, 0.3);
    assert.equal(days[1].total_usd, 1.5);
    assert.equal(totals.total_usd, 2.1);
    assert.equal(totals.calls, 4);
  });

  it('renders escaped names and never shows provider cost or markup', () => {
    const d = { company_id: 'c1', company_name: '<b>Acme</b>', from: '2026-11-01', to: '2026-11-30', ...{ lines: foldInvoiceDays(rows).days, totals: foldInvoiceDays(rows).totals } };
    const html = renderUsageInvoiceHtml(d, { name: 'Worxstream' });
    assert.ok(html.includes(usageInvoiceNumber(d)));
    assert.ok(html.includes('&lt;b&gt;Acme&lt;/b&gt;'));
    assert.ok(!/markup|provider cost|our margin/i.test(html));
    assert.ok(html.includes('$2.10'));
  });

  it('compareDaily carries the billable amount per day', () => {
    const cmp = compareDaily({ '2026-11-01': { cost_usd: 1, billable_usd: 1.2, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, { '2026-11-01': 1 }, {});
    assert.equal(cmp.rows[0].billable_usd, 1.2);
    assert.equal(cmp.totals.billable_usd, 1.2);
  });
});
