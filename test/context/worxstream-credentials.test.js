import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as worxstreamSession from '../../src/session/worxstreamSession.js';
import {
  buildWorxstreamContext,
  hasCompleteWorxstreamContext,
  resolveAgentCredentials,
} from '../../src/utils/worxstreamCredentials.js';
import { runWithRequestContext } from '../../src/request/requestContext.js';

describe('worxstreamCredentials', () => {
  it('prefers request body over session when env fallback is disabled', async () => {
    worxstreamSession.setSession({
      companyId: '100',
      userId: '200',
      apiToken: 'session-token',
    });

    await runWithRequestContext(
      { companyId: '10', userId: '20', apiToken: 'req-token' },
      async () => {
        const ctx = buildWorxstreamContext({}, { allowEnvFallback: false });
        assert.equal(ctx.companyId, '10');
        assert.equal(ctx.userId, '20');
        assert.equal(ctx.apiToken, 'req-token');
      },
    );

    worxstreamSession.clearSession();
  });

  it('uses session when request omits credentials and env fallback is disabled', () => {
    worxstreamSession.setSession({
      companyId: '300',
      userId: '400',
      apiToken: 'session-token',
    });

    const ctx = buildWorxstreamContext({}, { allowEnvFallback: false });
    assert.equal(ctx.companyId, '300');
    assert.equal(ctx.userId, '400');
    assert.equal(ctx.apiToken, 'session-token');

    worxstreamSession.clearSession();
  });

  it('does not use env defaults for agent credential resolution', () => {
    const prev = {
      company: process.env.DEFAULT_COMPANY_ID,
      user: process.env.DEFAULT_USER_ID,
      token: process.env.WORXSTREAM_API_TOKEN,
    };
    process.env.DEFAULT_COMPANY_ID = '999';
    process.env.DEFAULT_USER_ID = '888';
    process.env.WORXSTREAM_API_TOKEN = 'env-token';

    const ctx = resolveAgentCredentials({ body: {}, query: {}, headers: {} });
    assert.equal(hasCompleteWorxstreamContext(ctx), false);

    process.env.DEFAULT_COMPANY_ID = prev.company;
    process.env.DEFAULT_USER_ID = prev.user;
    process.env.WORXSTREAM_API_TOKEN = prev.token;
  });

  it('reads tenant ids from headers on GET-style requests', () => {
    const req = {
      body: {},
      query: {},
      headers: {
        authorization: 'Bearer header-token',
        'x-company-id': '42',
        'x-user-id': '43',
      },
    };

    const ctx = resolveAgentCredentials(req);
    assert.equal(ctx.companyId, '42');
    assert.equal(ctx.userId, '43');
    assert.equal(ctx.apiToken, 'header-token');
    assert.equal(hasCompleteWorxstreamContext(ctx), true);
  });
});
