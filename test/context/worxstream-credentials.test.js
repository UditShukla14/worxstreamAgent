import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as worxstreamSession from '../../src/session/worxstreamSession.js';
import {
  buildWorxstreamContext,
  hasCompleteWorxstreamContext,
  resolveAgentCredentials,
  resolveConversationTenantIds,
} from '../../src/utils/worxstreamCredentials.js';
import { runWithRequestContext } from '../../src/request/requestContext.js';

describe('worxstreamCredentials', () => {
  it('prefers request body over session', async () => {
    worxstreamSession.setSession({
      companyId: '100',
      userId: '200',
      apiToken: 'session-token',
    });

    await runWithRequestContext(
      { companyId: '10', userId: '20', apiToken: 'req-token' },
      async () => {
        const ctx = buildWorxstreamContext({}, { allowEnvTokenFallback: false });
        assert.equal(ctx.companyId, '10');
        assert.equal(ctx.userId, '20');
        assert.equal(ctx.apiToken, 'req-token');
      },
    );

    worxstreamSession.clearSession();
  });

  it('uses session when request omits credentials', () => {
    worxstreamSession.setSession({
      companyId: '300',
      userId: '400',
      apiToken: 'session-token',
    });

    const ctx = buildWorxstreamContext({}, { allowEnvTokenFallback: false });
    assert.equal(ctx.companyId, '300');
    assert.equal(ctx.userId, '400');
    assert.equal(ctx.apiToken, 'session-token');

    worxstreamSession.clearSession();
  });

  it('never overrides company/user from DEFAULT_* even when env token is set', () => {
    const prev = {
      company: process.env.DEFAULT_COMPANY_ID,
      user: process.env.DEFAULT_USER_ID,
      token: process.env.WORXSTREAM_API_TOKEN,
    };
    process.env.DEFAULT_COMPANY_ID = '999';
    process.env.DEFAULT_USER_ID = '888';
    process.env.WORXSTREAM_API_TOKEN = 'env-token';

    try {
      const ctx = resolveAgentCredentials({
        body: {},
        query: { companyId: '42', userId: '43' },
        headers: { authorization: 'Bearer header-token' },
      });
      assert.equal(ctx.companyId, '42');
      assert.equal(ctx.userId, '43');
      // Request bearer wins over env token when present
      assert.equal(ctx.apiToken, 'header-token');
      assert.equal(hasCompleteWorxstreamContext(ctx), true);
    } finally {
      process.env.DEFAULT_COMPANY_ID = prev.company;
      process.env.DEFAULT_USER_ID = prev.user;
      process.env.WORXSTREAM_API_TOKEN = prev.token;
    }
  });

  it('reads tenant ids from headers', () => {
    const prev = {
      company: process.env.DEFAULT_COMPANY_ID,
      user: process.env.DEFAULT_USER_ID,
      token: process.env.WORXSTREAM_API_TOKEN,
    };
    delete process.env.DEFAULT_COMPANY_ID;
    delete process.env.DEFAULT_USER_ID;
    delete process.env.WORXSTREAM_API_TOKEN;

    try {
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
    } finally {
      process.env.DEFAULT_COMPANY_ID = prev.company;
      process.env.DEFAULT_USER_ID = prev.user;
      process.env.WORXSTREAM_API_TOKEN = prev.token;
    }
  });

  it('conversation tenant uses query userId', async () => {
    await runWithRequestContext(
      { companyId: '1', userId: '2', apiToken: 't' },
      async () => {
        const ids = resolveConversationTenantIds({
          body: {},
          query: { companyId: '30000000021', userId: '10000000048' },
          headers: {},
        });
        assert.equal(ids.companyId, '30000000021');
        assert.equal(ids.userId, '10000000048');
      },
    );
  });

  it('conversation tenant ignores DEFAULT_* when request and session are empty', () => {
    const prev = {
      company: process.env.DEFAULT_COMPANY_ID,
      user: process.env.DEFAULT_USER_ID,
      token: process.env.WORXSTREAM_API_TOKEN,
    };
    process.env.DEFAULT_COMPANY_ID = '999';
    process.env.DEFAULT_USER_ID = '888';
    process.env.WORXSTREAM_API_TOKEN = 'env-token';
    worxstreamSession.clearSession();

    try {
      const ids = resolveConversationTenantIds({ body: {}, query: {}, headers: {} });
      assert.equal(ids.companyId, undefined);
      assert.equal(ids.userId, undefined);
    } finally {
      process.env.DEFAULT_COMPANY_ID = prev.company;
      process.env.DEFAULT_USER_ID = prev.user;
      process.env.WORXSTREAM_API_TOKEN = prev.token;
    }
  });

  it('conversation tenant falls back to session when query omits ids', () => {
    worxstreamSession.setSession({
      companyId: '300',
      userId: '400',
      apiToken: 'session-token',
    });

    try {
      const ids = resolveConversationTenantIds({ body: {}, query: {}, headers: {} });
      assert.equal(ids.companyId, '300');
      assert.equal(ids.userId, '400');
    } finally {
      worxstreamSession.clearSession();
    }
  });

  it('api token may fall back to WORXSTREAM_API_TOKEN without changing tenant', () => {
    const prev = process.env.WORXSTREAM_API_TOKEN;
    process.env.WORXSTREAM_API_TOKEN = 'env-token';
    worxstreamSession.clearSession();

    try {
      const ctx = resolveAgentCredentials({
        body: {},
        query: { companyId: '42', userId: '43' },
        headers: {},
      });
      assert.equal(ctx.companyId, '42');
      assert.equal(ctx.userId, '43');
      assert.equal(ctx.apiToken, 'env-token');
    } finally {
      process.env.WORXSTREAM_API_TOKEN = prev;
    }
  });
});
