import assert from 'node:assert/strict';
import test from 'node:test';

import { createResendWebhookHandler, deliveryEffect } from '../functions/api/resend-webhook.js';

const event = {
  type: 'email.delivered',
  created_at: '2026-08-04T12:00:00Z',
  data: {
    email_id: 'email-123',
    to: ['buyer@example.com'],
    subject: 'Private order details',
  },
};

function request(body = event) {
  return new Request('https://masest.co/api/resend-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_webhook_123',
      'svix-timestamp': '1785844800',
      'svix-signature': 'v1,signature',
    },
    body: JSON.stringify(body),
  });
}

test('Resend verifies raw request before durable ingestion', async () => {
  let ingests = 0;
  const handler = createResendWebhookHandler({
    verifySignature: async (_secret, headers, raw) => {
      assert.equal(headers.id, 'msg_webhook_123');
      assert.equal(JSON.parse(raw).data.email_id, 'email-123');
      return false;
    },
    ingest: async () => { ingests += 1; return { error: null }; },
  });
  const response = await handler({ request: request(), env: { RESEND_WEBHOOK_SECRET: 'secret' } });
  assert.equal(response.status, 400);
  assert.equal(ingests, 0);
});

test('Resend ACKs only after the verified event is durably queued', async () => {
  let seen;
  const handler = createResendWebhookHandler({
    verifySignature: async () => true,
    ingest: async (_env, raw, parsed, svixId) => {
      seen = { raw, parsed, svixId };
      return { data: 'integration-event-id', error: null };
    },
  });
  const response = await handler({ request: request(), env: { RESEND_WEBHOOK_SECRET: 'secret' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(seen.svixId, 'msg_webhook_123');
  assert.equal(seen.parsed.type, 'email.delivered');
});

test('Resend requests retry when DB ingest fails and fails closed when unconfigured', async () => {
  const handler = createResendWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => ({ error: new Error('db unavailable') }),
  });
  let response = await handler({ request: request(), env: { RESEND_WEBHOOK_SECRET: 'secret' } });
  assert.equal(response.status, 503);
  response = await handler({ request: request(), env: {} });
  assert.equal(response.status, 503);
});

test('Resend accepted unknown events remain durable receipts without direct mutations', async () => {
  let ingests = 0;
  const handler = createResendWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => { ingests += 1; return { error: null }; },
  });
  const response = await handler({
    request: request({ type: 'email.opened', created_at: event.created_at, data: event.data }),
    env: { RESEND_WEBHOOK_SECRET: 'secret' },
  });
  assert.equal(response.status, 200);
  assert.equal(ingests, 1);
});

test('Resend bounce effects retain only impacted recipient digests', async () => {
  const effects = await deliveryEffect({
    ...event,
    type: 'email.bounced',
    data: { ...event.data, to: ['buyer@example.com'] },
  });
  assert.equal(effects.length, 1);
  assert.deepEqual(Object.keys(effects[0].payload).sort(), [
    'event_type', 'occurred_at', 'recipient_digests', 'resend_id', 'status',
  ]);
  assert.match(effects[0].payload.recipient_digests[0], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(effects).includes('buyer@example.com'), false);
});
