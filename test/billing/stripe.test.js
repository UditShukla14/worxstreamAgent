import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit';

const { default: webhook } = await import('../../src/billing/stripe/webhook.js');
const { settleNovaPayment, NOVA_CREDITS_KIND } = await import('../../src/billing/stripe/novaCheckout.js');

function serve() {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use('/hook', webhook);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/hook` }));
  });
}

test('webhook rejects a request with a bad signature', async () => {
  const { server, url } = await serve();
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: '{"type":"payment_intent.succeeded"}' });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('webhook acknowledges a correctly signed event it does not act on', async () => {
  const { server, url } = await serve();
  try {
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'charge.refunded', data: { object: {} } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_unit' });
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true });
  } finally {
    server.close();
  }
});

test('settle ignores payments that are not Nova credit purchases or have not succeeded', async () => {
  assert.equal((await settleNovaPayment({ id: 'pi_1', status: 'succeeded', metadata: {} })).credited, false);
  assert.equal((await settleNovaPayment({ id: 'pi_2', status: 'requires_payment_method', metadata: { kind: NOVA_CREDITS_KIND, company_id: 'c1' } })).credited, false);
  assert.equal((await settleNovaPayment({ id: 'pi_3', status: 'succeeded', metadata: { kind: NOVA_CREDITS_KIND } })).credited, false);
});
