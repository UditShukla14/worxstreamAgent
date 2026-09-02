import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReportCriteria, readField } from '../../src/control/reportCriteria.js';

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
});
