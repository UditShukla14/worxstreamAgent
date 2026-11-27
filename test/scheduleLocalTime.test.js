import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFlowNextRunAt,
  describeScheduleCadence,
  parseLocalTime,
} from '../src/governance/schedules/flowEngine.js';
import { sanitizeTimezone } from '../src/request/requestContext.js';

const base = { cadence_type: 'interval', interval_days: 1, timezone: 'America/New_York', run_at_local_time: '19:00' };

describe('local-time interval schedules', () => {
  it('runs at 7 PM New York (winter = 00:00 UTC next day)', () => {
    const next = computeFlowNextRunAt(base, new Date('2026-11-27T07:06:00Z'));
    assert.equal(next.toISOString(), '2026-11-28T00:00:00.000Z');
  });
  it('rolls to the next day once today has passed', () => {
    const next = computeFlowNextRunAt(base, new Date('2026-11-28T01:00:00Z'));
    assert.equal(next.toISOString(), '2026-11-29T00:00:00.000Z');
  });
  it('keeps the wall-clock time across DST (summer = 23:00 UTC)', () => {
    const next = computeFlowNextRunAt(base, new Date('2026-07-01T12:00:00Z'));
    assert.equal(next.toISOString(), '2026-07-01T23:00:00.000Z');
  });
  it('legacy UTC hour is unchanged', () => {
    const next = computeFlowNextRunAt(
      { cadence_type: 'interval', interval_days: 1, run_at_hour_utc: 6 },
      new Date('2026-11-27T07:06:00Z'),
    );
    assert.equal(next.toISOString(), '2026-11-28T06:59:59.000Z');
  });
  it('describes in plain language', () => {
    assert.equal(describeScheduleCadence(base), 'Every day at 7:00 PM America/New_York');
  });
  it('parses and validates', () => {
    assert.deepEqual(parseLocalTime('7:05'), { hour: 7, minute: 5 });
    assert.equal(parseLocalTime('25:00'), null);
    assert.equal(sanitizeTimezone('Not/AZone'), undefined);
    assert.equal(sanitizeTimezone('Asia/Kolkata'), 'Asia/Kolkata');
  });
});
