import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeSalesBriefingEmail,
  composeScheduledMessage,
  computeMonthlyNextRunAt,
  formatDateInZone,
  renderScheduleTemplate,
  resolveFlowChannel,
  resolveFlowSteps,
  resolvePeriodWindows,
  unwrapInvoiceReportEnvelope,
  SUPPORTED_FLOW_TYPES,
} from '../src/governance/schedules/flowEngine.js';
import {
  isNovaScheduleFlow,
  stripAgentPresentationForDelivery,
} from '../src/governance/schedules/novaEngine.js';

describe('scheduled_message flow', () => {
  it('supports scheduled_message and legacy sales_email_briefing alias', () => {
    assert.equal(SUPPORTED_FLOW_TYPES.has('scheduled_message'), true);
    assert.equal(SUPPORTED_FLOW_TYPES.has('sales_email_briefing'), true);
  });

  it('resolves channel', () => {
    assert.equal(resolveFlowChannel({ channel: 'sms' }), 'sms');
    assert.equal(resolveFlowChannel({}), 'email');
  });

  it('resolves send-only process when only message_template', () => {
    const steps = resolveFlowSteps({ message_template: 'Hello {{date}}' });
    assert.deepEqual(steps.map((s) => s.type), ['compose', 'deliver']);
  });

  it('resolves Nova agent process from prompt', () => {
    assert.equal(
      isNovaScheduleFlow({
        engine: 'nova',
        prompt: 'Summarize today and MTD sales',
      }),
      true,
    );
    const steps = resolveFlowSteps({
      engine: 'nova',
      prompt: 'Summarize today and MTD sales',
      channel: 'email',
    });
    assert.deepEqual(steps.map((s) => s.type), ['nova_run', 'compose', 'deliver']);
  });

  it('strips chart/stats tags for email delivery', () => {
    const cleaned = stripAgentPresentationForDelivery(
      'Hello\n<stats><stat label="Sales" value="$1"/></stats>\n<table><tr><td>ok</td></tr></table>',
      'email',
    );
    assert.match(cleaned, /Hello/);
    assert.match(cleaned, /<table>/);
    assert.equal(/<stats/i.test(cleaned), false);
  });

  it('resolves invoice process from periods', () => {
    const steps = resolveFlowSteps({
      engine: 'process',
      periods: ['today', 'mtd'],
      metrics: ['sales', 'amount_paid'],
    });
    assert.deepEqual(steps.map((s) => s.type), [
      'invoice_report',
      'invoice_report',
      'compose',
      'deliver',
    ]);
    assert.equal(steps[0].period, 'today');
    assert.equal(steps[1].period, 'mtd');
  });

  it('resolves invoice process from pulled-live prose', () => {
    const steps = resolveFlowSteps({
      message_template: 'Sales today pulled live at send time. MTD also.',
    });
    assert.ok(steps.some((s) => s.type === 'invoice_report' && s.period === 'today'));
    assert.ok(steps.some((s) => s.type === 'invoice_report' && s.period === 'mtd'));
    assert.ok(steps.some((s) => s.type === 'deliver'));
  });

  it('resolves explicit steps including tool', () => {
    const steps = resolveFlowSteps({
      steps: [
        { type: 'tool', tool: 'generate_invoice_report', args: { period: 'today' } },
        { type: 'compose' },
        { type: 'deliver' },
      ],
    });
    assert.equal(steps[0].type, 'tool');
    assert.equal(steps[0].tool, 'generate_invoice_report');
  });

  it('resolves period windows', () => {
    const windows = resolvePeriodWindows(['today', 'mtd'], 'UTC', new Date('2026-10-15T12:00:00Z'));
    assert.equal(windows[0].from, '2026-10-15');
    assert.equal(windows[1].from, '2026-10-01');
  });

  it('composes sales briefing table', () => {
    const { subject, body } = composeSalesBriefingEmail({
      name: 'Daily Briefing',
      metrics: ['sales', 'amount_paid'],
      periods: [
        { key: 'today', label: 'Today', from: '2026-10-15', to: '2026-10-15', sales: 100, amount_paid: 40 },
      ],
      subject: 'Daily Briefing — 2026-10-15',
    });
    assert.match(subject, /Daily Briefing/);
    assert.match(body, /\$100/);
    assert.match(body, /\$40/);
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

  it('unwraps invoice report without peeling into rows (keeps meta.totals)', () => {
    const apiResult = {
      success: true,
      data: {
        success: true,
        data: {
          meta: {
            fromDate: '2026-10-01',
            toDate: '2026-10-15',
            totals: { grandTotal: 12500.5, tax: 100 },
          },
          data: [
            { id: 1, grandTotal: 10000 },
            { id: 2, grandTotal: 2500.5 },
          ],
          pagination: { total: 2, lastPage: 1, currentPage: 1 },
        },
      },
    };
    const envelope = unwrapInvoiceReportEnvelope(apiResult);
    assert.equal(envelope.meta.totals.grandTotal, 12500.5);
    assert.equal(envelope.data.length, 2);
    assert.equal(envelope.pagination.lastPage, 1);
  });

  it('unwraps already-flat invoice report envelope', () => {
    const envelope = unwrapInvoiceReportEnvelope({
      success: true,
      data: {
        meta: { totals: { grandTotal: 42 } },
        data: [{ id: 9, grandTotal: 42 }],
        pagination: { total: 1 },
      },
    });
    assert.equal(envelope.meta.totals.grandTotal, 42);
    assert.equal(envelope.data[0].id, 9);
  });
});
