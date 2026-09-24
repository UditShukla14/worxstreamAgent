import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWorxstreamContext, getWorxstreamApiToken } from '../../src/config/index.js';
import { runWithRequestContext } from '../../src/request/requestContext.js';

describe('Worxstream credentials (per-request)', () => {
  it('getWorxstreamApiToken falls back to WORXSTREAM_API_TOKEN env', () => {
    const prev = process.env.WORXSTREAM_API_TOKEN;
    process.env.WORXSTREAM_API_TOKEN = 'test-token-env';
    assert.equal(getWorxstreamApiToken(), 'test-token-env');
    process.env.WORXSTREAM_API_TOKEN = prev;
  });

  it('per-request context (ALS) supplies company/user — DEFAULT_* is ignored', async () => {
    const prevC = process.env.DEFAULT_COMPANY_ID;
    const prevU = process.env.DEFAULT_USER_ID;
    const prevT = process.env.WORXSTREAM_API_TOKEN;
    process.env.DEFAULT_COMPANY_ID = '42';
    process.env.DEFAULT_USER_ID = '99';
    delete process.env.WORXSTREAM_API_TOKEN;

    await runWithRequestContext({ companyId: '7', userId: '8', apiToken: 'req-token' }, async () => {
      const ctx = getWorxstreamContext();
      assert.equal(ctx.companyId, '7');
      assert.equal(ctx.userId, '8');
      assert.equal(getWorxstreamApiToken(), 'req-token');
    });

    // Outside the request scope, no DEFAULT_* company/user fallback
    const ctx = getWorxstreamContext();
    assert.equal(ctx.companyId, undefined);
    assert.equal(ctx.userId, undefined);

    process.env.DEFAULT_COMPANY_ID = prevC;
    process.env.DEFAULT_USER_ID = prevU;
    if (prevT === undefined) delete process.env.WORXSTREAM_API_TOKEN;
    else process.env.WORXSTREAM_API_TOKEN = prevT;
  });

  it('concurrent requests with different tenants do not bleed into each other', async () => {
    const prevT = process.env.WORXSTREAM_API_TOKEN;
    const prevC = process.env.DEFAULT_COMPANY_ID;
    const prevU = process.env.DEFAULT_USER_ID;
    delete process.env.WORXSTREAM_API_TOKEN;
    delete process.env.DEFAULT_COMPANY_ID;
    delete process.env.DEFAULT_USER_ID;

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

    if (prevT === undefined) delete process.env.WORXSTREAM_API_TOKEN;
    else process.env.WORXSTREAM_API_TOKEN = prevT;
    if (prevC === undefined) delete process.env.DEFAULT_COMPANY_ID;
    else process.env.DEFAULT_COMPANY_ID = prevC;
    if (prevU === undefined) delete process.env.DEFAULT_USER_ID;
    else process.env.DEFAULT_USER_ID = prevU;
  });
});
