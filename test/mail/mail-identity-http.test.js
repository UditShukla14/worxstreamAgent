import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

// A stand-in mail backend that records who is asking.
const seen = [];
const mailServer = http.createServer((req, res) => {
  seen.push(req.headers.authorization || '');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ success: true, data: [{ email: 'udit@alphaparktech.com' }] }));
});
await new Promise((r) => mailServer.listen(0, r));
process.env.MAIL_AGENT_API_URL = `http://127.0.0.1:${mailServer.address().port}`;
process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.WORXSTREAM_API_TOKEN = 'server-service-token';

const { requestContextMiddleware } = await import('../../src/middleware/requestContext.js');
const { mailBackend } = await import('../../src/services/mailBackendClient.js');
const session = await import('../../src/session/worxstreamSession.js');

let app;
let base;
before(async () => {
  app = express();
  app.use(express.json());
  app.use(requestContextMiddleware);
  // Same shape as the agent's chat route: parse, then work after some awaits, possibly in parallel.
  app.post('/api/agents/stream', async (req, res) => {
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    const [a, b] = await Promise.all([mailBackend.get('/account/accounts'), mailBackend.get('/account/accounts')]);
    res.json({ a, b });
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  app.locals.server = server;
});
after(() => {
  app.locals.server.close();
  mailServer.close();
});

const ask = (headers = {}, body = { companyId: '30', userId: '64' }) =>
  fetch(`${base}/api/agents/stream`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.json());

describe('mail acts as the person who is asking', () => {
  it('forwards the token the request carried', async () => {
    session.clearSession();
    seen.length = 0;
    const out = await ask({ Authorization: 'Bearer jwt-of-64' });
    assert.equal(out.a.success, true);
    assert.deepEqual([...new Set(seen)], ['Bearer jwt-of-64']);
  });

  it('keeps two people chatting at the same time apart', async () => {
    seen.length = 0;
    await Promise.all([
      ask({ Authorization: 'Bearer jwt-of-64' }, { companyId: '30', userId: '64' }),
      ask({ Authorization: 'Bearer jwt-of-16' }, { companyId: '30', userId: '16' }),
      ask({ Authorization: 'Bearer jwt-of-64' }, { companyId: '30', userId: '64' }),
    ]);
    assert.deepEqual([...new Set(seen)].sort(), ['Bearer jwt-of-16', 'Bearer jwt-of-64']);
    assert.equal(seen.filter((h) => h === 'Bearer jwt-of-64').length, 4);
    assert.equal(seen.filter((h) => h === 'Bearer jwt-of-16').length, 2);
  });

  it('without a header, uses the login session only when it is the same user', async () => {
    seen.length = 0;
    session.setSession({ userId: '64', companyId: '30', apiToken: 'session-jwt-of-64' });
    assert.equal((await ask()).a.success, true);
    assert.deepEqual([...new Set(seen)], ['Bearer session-jwt-of-64']);
  });

  it('refuses when the login session belongs to someone else', async () => {
    seen.length = 0;
    session.setSession({ userId: '999', companyId: '30', apiToken: 'someone-elses-session' });
    const out = await ask();
    assert.equal(out.a.success, false);
    assert.equal(out.a.status, 401);
    assert.equal(seen.length, 0); // the mail backend was never called as another person
  });

  it('never falls back to the server service token', async () => {
    seen.length = 0;
    session.clearSession();
    const out = await ask();
    assert.equal(out.a.success, false);
    assert.equal(seen.length, 0);
  });
});
