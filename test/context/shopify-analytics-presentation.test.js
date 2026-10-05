/**
 * Deterministic Shopify analytics presentation (Sidekick / ChatGPT tool-UI pattern).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShopifyAnalyticsPresentation,
  mergeShopifyPresentationWithCommentary,
  stripModelStatsAndCharts,
} from '../../src/nova/agents/shopifyAnalyticsPresentation.js';

describe('shopifyAnalyticsPresentation', () => {
  it('builds stats from a single totals row', () => {
    const xml = buildShopifyAnalyticsPresentation({
      success: true,
      data: {
        columns: [
          { name: 'gross_sales', dataType: 'MONEY', displayName: 'Gross sales' },
          { name: 'net_sales', dataType: 'MONEY', displayName: 'Net sales' },
          { name: 'orders', dataType: 'INTEGER', displayName: 'Orders' },
        ],
        rows: [{ gross_sales: 130263.35, net_sales: 95674.31, orders: 96 }],
      },
    }, { query: 'FROM sales SHOW gross_sales VISUALIZE gross_sales TYPE single_metric' });

    assert.match(xml, /<stats>/);
    assert.match(xml, /Gross sales/);
    assert.match(xml, /\$130,263\.35/);
    assert.match(xml, /Orders/);
  });

  it('builds a line chart from a daily timeseries', () => {
    const xml = buildShopifyAnalyticsPresentation({
      success: true,
      data: {
        columns: [
          { name: 'day', dataType: 'DAY_TIMESTAMP', displayName: 'Day' },
          { name: 'total_sales', dataType: 'MONEY', displayName: 'Total sales' },
        ],
        rows: [
          { day: '2026-10-01', total_sales: 33500 },
          { day: '2026-10-02', total_sales: 21000 },
          { day: '2026-10-03', total_sales: 18000 },
        ],
      },
    }, { query: 'FROM sales SHOW total_sales TIMESERIES day VISUALIZE total_sales TYPE line' });

    assert.match(xml, /<chart type="line"/);
    assert.match(xml, /<chart-data/);
    assert.match(xml, /<point period="Oct 1" value="33500"\/>/);
    assert.match(xml, /<point period="Oct 2" value="21000"\/>/);
    assert.match(xml, /<table/);
  });

  it('merges widgets ahead of commentary and strips broken model charts', () => {
    const widgets = '<stats>\n<stat label="Orders" value="96" icon="chart" color="cyan"/>\n</stats>';
    const model = 'Strong month so far.\n<chart type="line" title="Broken"></chart>\nMore insight.';
    const merged = mergeShopifyPresentationWithCommentary(widgets, model);
    assert.ok(merged.startsWith('<stats>'));
    assert.match(merged, /Strong month/);
    assert.ok(!merged.includes('<chart type="line" title="Broken"'));
    assert.equal(stripModelStatsAndCharts('<stats>x</stats>\nok').trim(), 'ok');
  });
});
