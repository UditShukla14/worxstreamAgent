import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { parseCostReport, parseUsageReport, compareDaily } = await import('../../src/analytics/anthropicReconcile.js');
const { walletMicros, computeRemainingUsd, walletToApi } = await import('../../src/analytics/novaWallet.js');

describe('Anthropic cost_report parsing', () => {
  const pages = [{
    data: [
      { starting_at: '2026-11-01T00:00:00Z', ending_at: '2026-11-02T00:00:00Z', results: [
        { amount: '123.5', currency: 'USD', cost_type: 'tokens', workspace_id: 'wrkspc_a' },
        { amount: '50', currency: 'USD', cost_type: 'web_search', workspace_id: 'wrkspc_a' },
        { amount: '1000', currency: 'USD', cost_type: 'tokens', workspace_id: 'wrkspc_other' },
      ] },
      { starting_at: '2026-11-02T00:00:00Z', ending_at: '2026-11-03T00:00:00Z', results: [] },
    ],
    has_more: false,
  }];

  it('converts cents strings to USD and sums per day / cost type', () => {
    const { byDay, byType } = parseCostReport(pages);
    assert.equal(Number(byDay['2026-11-01'].toFixed(3)), 11.735);
    assert.equal(byType.web_search, 0.5);
  });

  it('filters by workspace', () => {
    const { byDay } = parseCostReport(pages, { workspaceId: 'wrkspc_a' });
    assert.equal(Number(byDay['2026-11-01'].toFixed(4)), 1.735);
  });
});

describe('Anthropic usage_report parsing', () => {
  it('sums uncached input, cache read, both cache-creation TTLs, output and web search', () => {
    const byDay = parseUsageReport([{ data: [{ starting_at: '2026-11-01T00:00:00Z', results: [
      { uncached_input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 3 }, server_tool_use: { web_search_requests: 2 } },
      { uncached_input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } },
    ] }] }]);
    assert.deepEqual(byDay['2026-11-01'], { input_tokens: 101, output_tokens: 11, cache_read_input_tokens: 51, cache_creation_input_tokens: 10, web_search_requests: 2 });
  });
});

describe('compareDaily', () => {
  const ours = {
    '2026-11-01': { cost_usd: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    '2026-11-02': { cost_usd: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    '2026-11-03': { cost_usd: 12, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const theirs = { '2026-11-01': 10.05, '2026-11-02': 12, '2026-11-03': 10 };

  it('flags under- and over-recorded days beyond tolerance and passes small diffs', () => {
    const { rows, flagged_days, totals } = compareDaily(ours, theirs, {}, { today: '2099-01-01' });
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[1].status, 'under_recorded'); // Anthropic charged more than we metered
    assert.equal(rows[2].status, 'over_recorded');
    assert.equal(flagged_days, 2);
    assert.equal(totals.ours_usd, 32);
    assert.equal(totals.anthropic_usd, 32.05);
  });

  it("never alarms on today's partial day", () => {
    const { rows } = compareDaily({ '2026-11-02': ours['2026-11-02'] }, { '2026-11-02': 12 }, {}, { today: '2026-11-02' });
    assert.equal(rows[0].status, 'pending');
  });
});

describe('wallet integer money', () => {
  it('reads micros, falling back to legacy USD fields', () => {
    assert.equal(walletMicros({ spent_micros: 1_234_567 }, 'spent'), 1_234_567);
    assert.equal(walletMicros({ spent_usd: 1.234567 }, 'spent'), 1_234_567);
    assert.equal(walletMicros(null, 'spent'), 0);
  });

  it('computes remaining exactly (no float drift) and hides the markup from customers', () => {
    const doc = { company_id: 'c1', limits_enabled: true, free_allowance_micros: 5_000_000, purchased_credit_micros: 2_000_000, spent_micros: 1_234_567, markup_rate: 0.3 };
    assert.equal(computeRemainingUsd(doc), 5.765433);
    const api = walletToApi(doc);
    assert.equal(api.remaining_usd, 5.765433);
    assert.equal('markup_rate' in api, false);
  });
});
