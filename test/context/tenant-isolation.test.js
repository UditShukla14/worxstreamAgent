import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWorxstreamContext, getWorxstreamApiToken } from '../../src/config/index.js';
import { runWithRequestContext } from '../../src/request/requestContext.js';

describe('Worxstream credentials (env / session)', () => {
  it('uses DEFAULT_COMPANY_ID and DEFAULT_USER_ID from env when no session', () => {
    const prevC = process.env.DEFAULT_COMPANY_ID;
    const prevU = process.env.DEFAULT_USER_ID;
    process.env.DEFAULT_COMPANY_ID = '42';
    process.env.DEFAULT_USER_ID = '99';

    const ctx = getWorxstreamContext();
    assert.equal(ctx.companyId, '42');
    assert.equal(ctx.userId, '99');

    process.env.DEFAULT_COMPANY_ID = prevC;
    process.env.DEFAULT_USER_ID = prevU;
  });

  it('getWorxstreamApiToken falls back to WORXSTREAM_API_TOKEN env', () => {
    const prev = process.env.WORXSTREAM_API_TOKEN;
    process.env.WORXSTREAM_API_TOKEN = 'test-token-env';
    assert.equal(getWorxstreamApiToken(), 'test-token-env');
    process.env.WORXSTREAM_API_TOKEN = prev;
  });

  it('per-request context (ALS) takes precedence over env defaults', async () => {
    const prevC = process.env.DEFAULT_COMPANY_ID;
    const prevU = process.env.DEFAULT_USER_ID;
    process.env.DEFAULT_COMPANY_ID = '42';
    process.env.DEFAULT_USER_ID = '99';

    await runWithRequestContext({ companyId: '7', userId: '8', apiToken: 'req-token' }, async () => {
      const ctx = getWorxstreamContext();
      assert.equal(ctx.companyId, '7');
      assert.equal(ctx.userId, '8');
      assert.equal(getWorxstreamApiToken(), 'req-token');
    });

    // Outside the request scope, env fallback applies again
    const ctx = getWorxstreamContext();
    assert.equal(ctx.companyId, '42');
    assert.equal(ctx.userId, '99');

    process.env.DEFAULT_COMPANY_ID = prevC;
    process.env.DEFAULT_USER_ID = prevU;
  });

  it('concurrent requests with different tenants do not bleed into each other', async () => {
    const results = await Promise.all([
      runWithRequestContext({ companyId: 'A1', userId: 'U1' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getWorxstreamContext();
      }),
      runWithRequestContext({ companyId: 'B2', userId: 'U2' }, async () => {
        return getWorxstreamContext();
      }),
    ]);
    assert.equal(results[0].companyId, 'A1');
    assert.equal(results[1].companyId, 'B2');
  });
});
