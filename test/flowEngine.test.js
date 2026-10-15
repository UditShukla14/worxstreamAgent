import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeSalesBriefingEmail,
  formatDateInZone,
  resolvePeriodWindows,
} from '../src/governance/schedules/flowEngine.js';

describe('flowEngine period windows', () => {
  it('resolves today and mtd', () => {
    const asOf = new Date('2026-10-15T18:00:00.000Z');
    const windows = resolvePeriodWindows(['today', 'mtd'], 'UTC', asOf);
    assert.equal(windows.length, 2);
    assert.equal(windows[0].key, 'today');
    assert.equal(windows[0].from, '2026-10-15');
    assert.equal(windows[1].key, 'mtd');
    assert.equal(windows[1].from, '2026-10-01');
    assert.equal(windows[1].to, '2026-10-15');
  });

  it('formats date in zone', () => {
    assert.equal(formatDateInZone(new Date('2026-10-15T00:30:00.000Z'), 'UTC'), '2026-10-15');
  });
});

describe('composeSalesBriefingEmail', () => {
  it('includes sales and amount paid columns', () => {
    const { subject, body } = composeSalesBriefingEmail({
      name: 'Daily briefing for sales',
      metrics: ['sales', 'amount_paid'],
      scope: 'company_totals',
      periods: [
        {
          key: 'today',
          label: 'Today',
          from: '2026-10-15',
          to: '2026-10-15',
          sales: 1000,
          amount_paid: 400,
        },
      ],
    });
    assert.match(subject, /Daily briefing/);
    assert.match(body, /Cumulative sales/);
    assert.match(body, /Amount paid/);
    assert.match(body, /\$1,000\.00/);
  });
});
