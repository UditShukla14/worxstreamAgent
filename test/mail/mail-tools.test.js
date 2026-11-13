import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const { createMailBackendClient } = await import('../../src/services/mailBackendClient.js');
const { compactAnalytics, UNTRUSTED_NOTE } = await import('../../src/mcp/tools/mail.js');
await import('../../src/mcp/tools/index.js');
const { getToolIndex } = await import('../../src/mcp/toolIndex.js');

const fakeHttp = (impl) => ({ get: async (url, opts) => impl(url, opts) });

describe('mail backend client', () => {
  it('reports when mail is not configured', async () => {
    const client = createMailBackendClient({ baseUrl: '', getToken: () => 't' });
    const res = await client.get('/emails/search');
    assert.equal(res.success, false);
    assert.match(res.error, /not configured/);
  });

  it('refuses to call without a session token', async () => {
    const client = createMailBackendClient({ baseUrl: 'http://mail', getToken: () => '', http: fakeHttp(() => assert.fail('no call')) });
    assert.equal((await client.get('/x')).status, 401);
  });

  it('forwards the user token, drops empty params and unwraps data', async () => {
    let seen;
    const client = createMailBackendClient({
      baseUrl: 'http://mail',
      getToken: () => 'user-jwt',
      http: fakeHttp((url, opts) => {
        seen = { url, opts };
        return { data: { success: true, data: { total: 2 } } };
      }),
    });
    const res = await client.get('/emails/search', { q: 'invoice', from: '', page: undefined, limit: 5 });
    assert.deepEqual(res, { success: true, data: { total: 2 } });
    assert.equal(seen.url, 'http://mail/emails/search');
    assert.equal(seen.opts.headers.Authorization, 'Bearer user-jwt');
    assert.deepEqual(seen.opts.params, { q: 'invoice', limit: 5 });
  });

  it('maps an auth rejection to a clear error', async () => {
    const client = createMailBackendClient({
      baseUrl: 'http://mail',
      getToken: () => 't',
      http: fakeHttp(() => {
        const e = new Error('Request failed');
        e.response = { status: 401, data: { error: 'Invalid or expired token' } };
        throw e;
      }),
    });
    const res = await client.get('/x');
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
    assert.match(res.error, /Sign in again/);
  });
});

describe('mail identity', () => {
  it('uses only the token the request itself carried, never a fallback', async () => {
    const { runWithRequestContext } = await import('../../src/request/requestContext.js');
    process.env.WORXSTREAM_API_TOKEN = 'service-account-token';
    const seen = [];
    const client = createMailBackendClient({ baseUrl: 'http://mail', http: fakeHttp((url, opts) => { seen.push(opts.headers.Authorization); return { data: { success: true, data: [] } }; }) });

    // a request that carried the user's token
    await runWithRequestContext({ companyId: '1', userId: '2', apiToken: 'user-jwt', userToken: 'user-jwt' }, () => client.get('/account/accounts'));
    assert.deepEqual(seen, ['Bearer user-jwt']);

    // a request that carried none: the service token must NOT be used, and the call is refused
    const res = await runWithRequestContext({ companyId: '1', userId: '2', apiToken: 'service-account-token' }, () => client.get('/account/accounts'));
    assert.equal(res.status, 401);
    assert.match(res.error, /signed-in session/);
    assert.equal(seen.length, 1);
    delete process.env.WORXSTREAM_API_TOKEN;
  });
});

describe('mail tools', () => {
  it('registers the ten read-only tools under the mail domain', () => {
    const names = (getToolIndex().byDomain.mail || []).map((t) => t.name).sort();
    assert.deepEqual(names, ['get_mail_conversation', 'get_mail_message', 'get_mail_sync_status', 'get_mailbox_overview', 'get_unread_mail_summary', 'list_mail_accounts', 'list_mail_attachments', 'list_mail_folders', 'search_mail', 'search_mail_live']);
  });

  it('drops zero-count days from the volume series', () => {
    const out = compactAnalytics({ volumeOverTime: [{ date: 'a', count: 0 }, { date: 'b', count: 3 }], enrichedCount: 4 });
    assert.deepEqual(out.volumeOverTime, [{ date: 'b', count: 3 }]);
    assert.equal(out.enrichedCount, 4);
  });

  it('warns that email text is untrusted', () => {
    assert.match(UNTRUSTED_NOTE, /untrusted/);
  });
});
