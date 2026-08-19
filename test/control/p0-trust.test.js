import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hmacSha256Hex, verifyWebhookAuth } from '../../src/control/verifyWebhook.js';
import { bindCompanyId, bindUserId, parseUserInfoPayload } from '../../src/utils/worxstreamIdentity.js';
import { agentStatFromRuns, runBelongsToAgent, stepBelongsToAgent } from '../../src/control/dashboardStats.js';
import { interruptOrphanedRun, ORPHAN_RUN_DETAIL } from '../../src/control/reconcileOrphanedRuns.js';

describe('verifyWebhookAuth', () => {
  const secret = 'tower-secret';
  const body = Buffer.from('{"event":"estimate_updated"}');

  it('fails closed in production when the secret is unset', () => {
    const result = verifyWebhookAuth({ secret: '', isProduction: true, secretHeader: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('allows unsigned traffic in non-production when the secret is unset', () => {
    const result = verifyWebhookAuth({ secret: '', isProduction: false });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'open');
  });

  it('accepts the shared-secret header with a constant-time compare', () => {
    const result = verifyWebhookAuth({
      secret,
      isProduction: true,
      secretHeader: secret,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'secret');
  });

  it('rejects a wrong shared secret', () => {
    const result = verifyWebhookAuth({
      secret,
      isProduction: true,
      secretHeader: 'nope',
    });
    assert.equal(result.ok, false);
  });

  it('accepts HMAC-SHA256 over the raw body', () => {
    const signature = `sha256=${hmacSha256Hex(secret, body)}`;
    const result = verifyWebhookAuth({
      secret,
      isProduction: true,
      signatureHeader: signature,
      rawBody: body,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'hmac');
  });

  it('rejects a tampered HMAC', () => {
    const result = verifyWebhookAuth({
      secret,
      isProduction: true,
      signatureHeader: `sha256=${hmacSha256Hex(secret, body)}ff`,
      rawBody: body,
    });
    assert.equal(result.ok, false);
  });
});

describe('worxstream identity bind', () => {
  const nestedInfo = {
    success: true,
    data: {
      user: { id: 16, name: 'Ada' },
      companyRoles: {
        21: { companyId: 21, companyName: 'Acme' },
        44: { companyId: 44, companyName: 'Other' },
      },
    },
  };

  it('parses nested user-info payloads', () => {
    const identity = parseUserInfoPayload(nestedInfo);
    assert.equal(identity?.userId, '16');
    assert.deepEqual(identity?.companyIds.sort(), ['21', '44']);
  });

  it('binds company_id to companies on the session', () => {
    const identity = parseUserInfoPayload(nestedInfo);
    assert.equal(bindCompanyId('21', identity), '21');
    assert.equal(bindCompanyId('99', identity), null);
    assert.equal(bindUserId('16', identity), '16');
    assert.equal(bindUserId('1', identity), null);
    assert.equal(bindUserId('', identity), '16');
  });

  it('allows the claimed company when user-info has no company list', () => {
    const identity = parseUserInfoPayload({ user: { id: 7 } });
    assert.equal(bindCompanyId('30000000021', identity), '30000000021');
    assert.equal(bindCompanyId('', identity), null);
  });
});

describe('dashboard Aegis attribution', () => {
  it('matches finding keys with an aegis_ prefix', () => {
    assert.equal(stepBelongsToAgent({ agentKey: 'aegis' }, 'aegis'), true);
    assert.equal(stepBelongsToAgent({ agentKey: 'aegis_policy_1' }, 'aegis'), true);
    assert.equal(stepBelongsToAgent({ agentKey: 'aegis_rule_9' }, 'aegis'), true);
    assert.equal(stepBelongsToAgent({ agentKey: 'estimate' }, 'aegis'), false);
  });

  it('attributes runs from pipeline or finding keys and uses run status for pass rate', () => {
    const today = new Date('2026-08-19T00:00:00Z');
    const weekRuns = [
      {
        pipeline: ['aegis'],
        status: 'pass',
        timestamp: '2026-08-19T11:00:00Z',
        total_duration_ms: 100,
        steps: [{ agentKey: 'aegis_policy_margin', verdict: 'pass' }],
      },
      {
        pipeline: ['aegis'],
        status: 'flagged',
        timestamp: '2026-08-18T11:00:00Z',
        total_duration_ms: 200,
        steps: [{ agentKey: 'aegis_rule_credit', verdict: 'flag' }],
      },
    ];

    assert.equal(runBelongsToAgent(weekRuns[0], 'aegis'), true);
    const stat = agentStatFromRuns(weekRuns, 'aegis', { today });
    assert.equal(stat.runsToday, 1);
    assert.equal(stat.passRate, 50);
    assert.equal(stat.status, 'degraded');
    assert.equal(stat.avgDurationMs, 150);
  });
});

describe('orphan run interrupt', () => {
  it('marks running steps and the run as error without inventing alerts', () => {
    const patched = interruptOrphanedRun({
      status: 'running',
      steps: [
        { agentKey: 'aegis_policy_1', verdict: 'pass', message: 'ok' },
        { agentKey: 'aegis_policy_2', verdict: 'running', message: '', responseExcerpt: '' },
      ],
    });
    assert.equal(patched.status, 'error');
    assert.equal(patched.steps[0].verdict, 'pass');
    assert.equal(patched.steps[1].verdict, 'error');
    assert.equal(patched.steps[1].detail, ORPHAN_RUN_DETAIL);
  });
});
