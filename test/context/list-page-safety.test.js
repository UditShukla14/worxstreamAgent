/**
 * Hard safety: list tools must stay page-wise (no bulk dumps into the model).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const {
  normalizeListInput,
  shouldFetchAllPages,
  getMaxListPageSize,
} = await import('../../src/nova/agents/policies/listPolicies.js');

describe('list page-size safety', () => {
  it('never allows multi-page aggregation', () => {
    assert.equal(shouldFetchAllPages({ all_pages: true }), false);
    assert.equal(shouldFetchAllPages({}), false);
  });

  it('strips all_pages and clamps limit', () => {
    const out = normalizeListInput({
      all_pages: true,
      max_pages: 50,
      limit: 5000,
      page: 2,
      filter: {
        advance: [{ db_attribute: 'created_date', operator: 'BETWEEN', value: ['2026-01-01', '2026-01-31'] }],
      },
    });
    assert.equal(out.all_pages, undefined);
    assert.equal(out.max_pages, undefined);
    assert.equal(out.limit, getMaxListPageSize());
    assert.equal(out.page, 2);
    assert.equal(out.filter.advance[0].db_attribute, 'created_at');
    assert.equal(out.filter.advance[0].value, '2026-01-01,2026-01-31');
  });

  it('defaults to a safe page size', () => {
    const out = normalizeListInput({});
    assert.ok(out.limit <= getMaxListPageSize());
    assert.ok(out.limit >= 1);
  });
});
