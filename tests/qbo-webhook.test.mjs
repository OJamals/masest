import assert from 'node:assert/strict';
import test from 'node:test';

import { createQboWebhookHandler } from '../functions/api/qbo-webhook.js';
import {
  normalizeQboWebhookEvents,
  verifyQboWebhookSignature,
} from '../functions/_lib/qbo-webhook.js';

const payload = [{
  specversion: '1.0',
  id: 'qbo-event-1',
  type: 'qbo.invoice.updated.v1',
  time: '2026-08-04T14:00:00Z',
  intuitaccountid: 'realm-1',
  data: { id: 'invoice-9' },
}, {
  specversion: '1.0',
  id: 'qbo-event-2',
  type: 'qbo.customer.created.v1',
  time: '2026-08-04T14:00:01Z',
  intuitaccountid: 'realm-2',
  data: { id: 'customer-3' },
}];

function request(body = payload) {
  return new Request('https://masest.co/api/qbo-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'intuit-signature': 'signature',
      'intuit-t-id': 'tid-123',
    },
    body: JSON.stringify(body),
  });
}

test('QBO HMAC verifier matches Intuit base64 contract', async () => {
  const raw = JSON.stringify(payload);
  const token = 'verifier-token';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const signature = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  assert.equal(await verifyQboWebhookSignature(token, signature, raw), true);
  assert.equal(await verifyQboWebhookSignature(token, `${signature}x`, raw), false);
});

test('QBO CloudEvents normalize official qbo.entity.operation.version types', async () => {
  assert.deepEqual(await normalizeQboWebhookEvents(payload), [{
    event_id: 'qbo-event-1',
    event_type: 'qbo.invoice.updated.v1',
    realm_id: 'realm-1',
    entity_name: 'invoice',
    entity_id: 'invoice-9',
    operation: 'updated',
    occurred_at: '2026-08-04T14:00:00.000Z',
  }, {
    event_id: 'qbo-event-2',
    event_type: 'qbo.customer.created.v1',
    realm_id: 'realm-2',
    entity_name: 'customer',
    entity_id: 'customer-3',
    operation: 'created',
    occurred_at: '2026-08-04T14:00:01.000Z',
  }]);
});

test('QBO verifies then atomically ingests a large multi-realm batch in one call under three seconds', async () => {
  const many = Array.from({ length: 500 }, (_, index) => ({
    ...payload[index % 2],
    id: `qbo-event-${index}`,
    intuitaccountid: `realm-${index % 7}`,
    data: { id: `entity-${index}` },
  }));
  const calls = [];
  const handler = createQboWebhookHandler({
    verifySignature: async () => true,
    ingest: async (_env, events, intuitTid) => {
      calls.push({ events, intuitTid });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { data: events.length, error: null };
    },
  });
  const started = performance.now();
  const response = await handler({
    request: request(many),
    env: { QBO_WEBHOOK_VERIFIER_TOKEN: 'verifier-token', QBO_ENVIRONMENT: 'production' },
  });
  assert.ok(performance.now() - started < 3000);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, accepted: 500 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].events.length, 500);
  assert.equal(calls[0].intuitTid, 'tid-123');
});

test('QBO forged signature creates no receipt and DB failure requests retry', async () => {
  let calls = 0;
  let handler = createQboWebhookHandler({
    verifySignature: async () => false,
    ingest: async () => { calls += 1; return { error: null }; },
  });
  const env = { QBO_WEBHOOK_VERIFIER_TOKEN: 'verifier-token' };
  assert.equal((await handler({ request: request(), env })).status, 401);
  assert.equal(calls, 0);

  handler = createQboWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => ({ error: new Error('db unavailable') }),
  });
  assert.equal((await handler({ request: request(), env })).status, 503);
});

test('QBO legacy fallback identity is canonical, order-independent, and update-sensitive', async () => {
  const legacy = (entities) => ({ eventNotifications: [{
    realmId: 'realm-1', dataChangeEvent: { entities },
  }] });
  const first = await normalizeQboWebhookEvents(legacy([{
    name: 'Invoice', id: '9', operation: 'Update', lastUpdated: '2026-08-04T14:00:00Z',
  }]));
  const duplicate = await normalizeQboWebhookEvents(legacy([{
    operation: 'Update', lastUpdated: '2026-08-04T14:00:00Z', id: '9', name: 'Invoice',
  }]));
  const distinct = await normalizeQboWebhookEvents(legacy([{
    name: 'Invoice', id: '9', operation: 'Update', lastUpdated: '2026-08-04T14:01:00Z',
  }]));
  assert.equal(first[0].event_id, duplicate[0].event_id);
  assert.notEqual(first[0].event_id, distinct[0].event_id);
  assert.match(first[0].event_id, /^legacy:v2:[a-f0-9]{64}$/);
});

test('QBO accepts payloads through 2 MiB and rejects larger bodies', async () => {
  const handler = createQboWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => ({ data: 1, error: null }),
  });
  const env = { QBO_WEBHOOK_VERIFIER_TOKEN: 'verifier-token' };
  const near = [{ ...payload[0], padding: 'x'.repeat((2 * 1024 * 1024) - 2048) }];
  assert.equal((await handler({ request: request(near), env })).status, 200);
  const over = [{ ...payload[0], padding: 'x'.repeat((2 * 1024 * 1024) + 1) }];
  assert.equal((await handler({ request: request(over), env })).status, 413);
});
