import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateReportCriteria,
  needsCriteriaDetailEnrichment,
  readField,
} from '../../src/governance/reports/criteria.js';

describe('report criteria', () => {
  it('detects missing tracking fields', () => {
    const match = evaluateReportCriteria(
      { trackingNo: '1', trackingUrl: '', trackingCompany: 'UPS' },
      'missing_fields',
      ['trackingNo', 'trackingUrl', 'trackingCompany'],
    );
    assert.ok(match);
    assert.match(match.reason, /trackingUrl/);
  });

  it('passes when all tracking fields are present', () => {
    const match = evaluateReportCriteria(
      { trackingNo: '1', trackingUrl: 'https://x', trackingCompany: 'UPS' },
      'missing_fields',
      ['trackingNo', 'trackingUrl', 'trackingCompany'],
    );
    assert.equal(match, null);
  });

  it('detects negative gross profit', () => {
    const match = evaluateReportCriteria(
      { grossProfitTotal: -10, grossProfitPercentage: 5 },
      'negative_profit',
      [],
    );
    assert.ok(match);
    assert.match(match.reason, /Negative gross profit/);
  });

  it('reads snake_case fields', () => {
    assert.equal(readField({ gross_profit_total: 12 }, 'grossProfitTotal'), 12);
  });

  it('requests detail enrichment when list row looks missing but fields may exist on show', () => {
    const listRow = { id: 80000020329, customNumber: '26-5555', trackingNo: '', trackingUrl: '', trackingCompany: '' };
    assert.equal(
      evaluateReportCriteria(listRow, 'missing_fields', ['trackingNo', 'trackingUrl', 'trackingCompany']) != null,
      true,
    );
    assert.equal(
      needsCriteriaDetailEnrichment(listRow, ['trackingNo', 'trackingUrl', 'trackingCompany']),
      true,
    );
  });

  it('skips detail enrichment when list row already has all criteria values', () => {
    const listRow = {
      trackingNo: '1ZC6R0860313743764',
      trackingUrl: 'https://ups.com/track',
      trackingCompany: 'UPS',
    };
    assert.equal(needsCriteriaDetailEnrichment(listRow, ['trackingNo', 'trackingUrl', 'trackingCompany']), false);
  });
});
