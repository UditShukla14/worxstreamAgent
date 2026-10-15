import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeScheduledMessage,
  computeMonthlyNextRunAt,
  formatDateInZone,
  renderScheduleTemplate,
  resolveFlowChannel,
  SUPPORTED_FLOW_TYPES,
} from '../src/governance/schedules/flowEngine.js';

describe('scheduled_message flow', () => {
  it('supports scheduled_message and legacy sales_email_briefing alias', () => {
    assert.equal(SUPPORTED_FLOW_TYPES.has('scheduled_message'), true);
    assert.equal(SUPPORTED_FLOW_TYPES.has('sales_email_briefing'), true);
  });

  it('resolves channel', () => {
    assert.equal(resolveFlowChannel({ channel: 'sms' }), 'sms');
    assert.equal(resolveFlowChannel({}), 'email');
  });

  it('renders template placeholders', () => {
    const text = renderScheduleTemplate('Hi {{name}} on {{date}}', {
      name: 'Alert',
      dateLabel: '2026-10-15',
    });
    assert.equal(text, 'Hi Alert on 2026-10-15');
  });

  it('composes SMS with opt-out footer', () => {
    const composed = composeScheduledMessage(
      {
        channel: 'sms',
        message_template: '78 taxable customers missing tax rate as of {{date}}.',
      },
      { name: 'Taxable reminder' },
      'UTC',
    );
    assert.equal(composed.channel, 'sms');
    assert.match(composed.body, /78 taxable/);
    assert.match(composed.body, /STOP/i);
  });

  it('composes email HTML from plain text', () => {
    const composed = composeScheduledMessage(
      {
        channel: 'email',
        subject_template: 'Daily note {{date}}',
        message_template: 'Hello team',
      },
      { name: 'Note' },
      'UTC',
    );
    assert.equal(composed.channel, 'email');
    assert.match(composed.subject, /Daily note/);
    assert.match(composed.body, /Hello team/);
    assert.match(composed.body, /<p/);
  });

  it('computes next monthly run after 1st 9am local', () => {
    const next = computeMonthlyNextRunAt(
      {
        cadence_type: 'monthly',
        day_of_month: 1,
        run_at_hour_local: 9,
        timezone: 'America/New_York',
      },
      new Date('2026-10-15T18:00:00.000Z'),
    );
    assert.ok(next > new Date('2026-10-15T18:00:00.000Z'));
    assert.equal(formatDateInZone(next, 'America/New_York'), '2026-11-01');
  });
});
