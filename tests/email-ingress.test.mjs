import assert from 'node:assert/strict';
import test from 'node:test';

import { signEmailBridgePayload } from '../shared/email-bridge.js';
import { createEmailInboundHandler } from '../functions/api/email/inbound.js';

const secret = 'bridge-secret-for-tests';
const payload = {
  id: '<reply-1@example.com>',
  from: 'buyer@example.com',
  to: ['reply+11111111-1111-4111-8111-111111111111.0123456789abcdef0123@reply.masest.co'],
  subject: 'Re: MASEST support',
  text: 'Please link this to my order.',
  html: null,
  headers: {
    'message-id': '<reply-1@example.com>',
    'in-reply-to': '<parent@example.com>',
    references: '<root@example.com> <parent@example.com>',
  },
};

async function signedRequest(body = payload, timestamp = Math.floor(Date.now() / 1000), signatureSecret = secret) {
  const raw = JSON.stringify(body);
  const signature = await signEmailBridgePayload(signatureSecret, timestamp, raw);
  return new Request('https://masest.co/api/email/inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-masest-email-timestamp': String(timestamp),
      'x-masest-email-signature': signature,
    },
    body: raw,
  });
}

test('signed Cloudflare inbound email enters the canonical support router', async () => {
  let routed = null;
  const handler = createEmailInboundHandler({
    now: () => Date.now(),
    routeInbound: async (_env, input) => {
      routed = input;
      return { routed: true, duplicate: false };
    },
  });
  const response = await handler({
    request: await signedRequest(),
    env: { EMAIL_INGRESS_SECRET: secret },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, routed: true, duplicate: false });
  assert.deepEqual(routed, payload);
});

test('email ingress fails closed for missing config, invalid signatures, and stale requests', async () => {
  const handler = createEmailInboundHandler({ now: () => Date.now(), routeInbound: async () => ({ routed: true }) });
  let response = await handler({ request: await signedRequest(), env: {} });
  assert.equal(response.status, 503);

  response = await handler({ request: await signedRequest(payload, Math.floor(Date.now() / 1000), 'wrong-secret'), env: { EMAIL_INGRESS_SECRET: secret } });
  assert.equal(response.status, 401);

  const stale = Math.floor(Date.now() / 1000) - 301;
  response = await handler({ request: await signedRequest(payload, stale), env: { EMAIL_INGRESS_SECRET: secret } });
  assert.equal(response.status, 401);
});

test('email ingress bounds request bodies before parsing', async () => {
  const handler = createEmailInboundHandler({ routeInbound: async () => ({ routed: true }) });
  const response = await handler({
    request: new Request('https://masest.co/api/email/inbound', {
      method: 'POST',
      headers: {
        'content-length': String(300 * 1024),
        'x-masest-email-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-masest-email-signature': '00',
      },
      body: '{}',
    }),
    env: { EMAIL_INGRESS_SECRET: secret },
  });
  assert.equal(response.status, 413);
});
