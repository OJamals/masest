import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEmailLifecycleEvent } from '../functions/_lib/email-events.js';
import { createEmailEventsHandler } from '../functions/api/email/events.js';
import { signEmailBridgePayload } from '../shared/email-bridge.js';

const secret = 'event-bridge-secret';
const delivered = {
  type: 'cf.email.sending.message.delivered',
  source: { type: 'email.sending', zoneId: 'zone-1', domain: 'send.masest.co' },
  payload: {
    eventId: '0190d0c4-7e9a-7b3c-9f12-1a2b3c4d5e6f',
    messageId: 'cf-message-1',
    sender: 'noreply@send.masest.co',
    recipient: 'buyer@example.com',
    terminal: true,
    delivery: { status: 'delivered' },
  },
  metadata: { eventTimestamp: '2026-08-31T12:00:00.000Z' },
};

test('Cloudflare lifecycle events normalize to provider-neutral bounded records', () => {
  assert.deepEqual(normalizeEmailLifecycleEvent(delivered), {
    eventId: delivered.payload.eventId,
    providerMessageId: 'cf-message-1',
    recipient: 'buyer@example.com',
    status: 'delivered',
    terminal: true,
    occurredAt: '2026-08-31T12:00:00.000Z',
    suppressionReason: null,
  });
  const bounced = structuredClone(delivered);
  bounced.type = 'cf.email.sending.message.bounced';
  bounced.payload.delivery.status = 'bounced';
  bounced.payload.bounce = { type: 'hard', reason: 'private provider detail' };
  assert.equal(normalizeEmailLifecycleEvent(bounced).suppressionReason, 'bounce');
  assert.throws(() => normalizeEmailLifecycleEvent({ ...delivered, source: { ...delivered.source, domain: 'other.example' } }), /invalid_email_event_domain/);
});

async function signedEventsRequest(events, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify({ events });
  const signature = await signEmailBridgePayload(secret, timestamp, raw);
  return new Request('https://masest.co/api/email/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-masest-email-timestamp': String(timestamp),
      'x-masest-email-signature': signature,
    },
    body: raw,
  });
}

test('signed lifecycle batches are durably applied before ACK', async () => {
  const applied = [];
  const handler = createEmailEventsHandler({
    applyEvent: async (_env, event) => applied.push(event),
  });
  const response = await handler({
    request: await signedEventsRequest([delivered]),
    env: { EMAIL_INGRESS_SECRET: secret },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 1 });
  assert.equal(applied[0].providerMessageId, 'cf-message-1');
});

test('lifecycle endpoint rejects invalid signatures and retries failed durable writes', async () => {
  const handler = createEmailEventsHandler({ applyEvent: async () => { throw new Error('db_down'); } });
  const valid = await signedEventsRequest([delivered]);
  let response = await handler({ request: valid, env: { EMAIL_INGRESS_SECRET: secret } });
  assert.equal(response.status, 503);

  response = await handler({
    request: new Request('https://masest.co/api/email/events', {
      method: 'POST',
      headers: {
        'x-masest-email-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-masest-email-signature': '0'.repeat(64),
      },
      body: JSON.stringify({ events: [delivered] }),
    }),
    env: { EMAIL_INGRESS_SECRET: secret },
  });
  assert.equal(response.status, 401);
});
