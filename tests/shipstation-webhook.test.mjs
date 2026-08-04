import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createShipStationWebhookHandler,
  trackingUpdateFromPayload,
} from '../functions/api/shipstation-webhook.js';

const payload = {
  resource_type: 'API_TRACK',
  data: {
    tracking_number: '1Z999AA10123456784',
    status_code: 'DE',
    status_description: 'Delivered',
    estimated_delivery_date: '2026-08-08T00:00:00Z',
    actual_delivery_date: '2026-08-07T16:10:00Z',
    events: [{
      occurred_at: '2026-08-07T16:10:00Z',
      event_code: 'DELIVERED',
      description: 'Delivered',
    }],
  },
};

function request(token = 'hook-token', body = payload) {
  return new Request('https://masest.co/api/shipstation-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-masest-webhook-token': token,
      'x-shipengine-rsa-sha256-key-id': 'kid-1',
      'x-shipengine-rsa-sha256-signature': 'signature',
      'x-shipengine-timestamp': '2026-08-07T16:10:01Z',
    },
    body: JSON.stringify(body),
  });
}

test('tracking webhook payload maps provider occurrence and identity deterministically', async () => {
  const update = await trackingUpdateFromPayload(payload);
  assert.equal(update.tracking_number, '1Z999AA10123456784');
  assert.equal(update.tracking_status, 'delivered');
  assert.equal(update.status_code, 'DE');
  assert.equal(update.event_code, 'DELIVERED');
  assert.equal(update.occurred_at, '2026-08-07T16:10:00.000Z');
  assert.equal(update.note, 'Delivered');
  assert.match(update.event_key, /^[a-f0-9]{64}$/);
});

test('tracking normalization chooses newest provider occurrence regardless event array order', async () => {
  const events = [{
    occurred_at: '2026-08-07T16:10:00Z', event_code: 'DELIVERED', description: 'Delivered',
  }, {
    occurred_at: '2026-08-06T10:00:00Z', event_code: 'IN_TRANSIT', description: 'In transit',
  }];
  const forward = await trackingUpdateFromPayload({ ...payload, data: { ...payload.data, events } });
  const reverse = await trackingUpdateFromPayload({ ...payload, data: { ...payload.data, events: [...events].reverse() } });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.occurred_at, '2026-08-07T16:10:00.000Z');
  assert.equal(forward.event_code, 'DELIVERED');
});

test('tracking normalization uses latest carrier occurrence and keeps carrier-only updates distinct', async () => {
  const first = await trackingUpdateFromPayload({
    ...payload,
    data: {
      ...payload.data,
      events: [
        { carrier_occurred_at: '2026-08-06T10:00:00Z', event_code: 'IT', description: 'In transit' },
        { carrier_occurred_at: '2026-08-07T12:00:00Z', event_code: 'OD', description: 'Out for delivery' },
      ],
    },
  });
  const second = await trackingUpdateFromPayload({
    ...payload,
    data: {
      ...payload.data,
      events: [
        { carrier_occurred_at: '2026-08-06T10:00:00Z', event_code: 'IT', description: 'In transit' },
        { carrier_occurred_at: '2026-08-07T13:00:00Z', event_code: 'OD', description: 'Out for delivery' },
      ],
    },
  });
  assert.equal(first.occurred_at, '2026-08-07T12:00:00.000Z');
  assert.equal(first.event_code, 'OD');
  assert.notEqual(first.event_key, second.event_key);
});

test('canonical tracking digest dedupes JSON reserialization but separates real updates', async () => {
  const reordered = {
    data: {
      events: [...payload.data.events],
      actual_delivery_date: payload.data.actual_delivery_date,
      estimated_delivery_date: payload.data.estimated_delivery_date,
      status_description: payload.data.status_description,
      status_code: payload.data.status_code,
      tracking_number: payload.data.tracking_number,
    },
    resource_type: 'API_TRACK',
  };
  const same = await trackingUpdateFromPayload(reordered);
  const original = await trackingUpdateFromPayload(payload);
  const distinct = await trackingUpdateFromPayload({
    ...payload,
    data: { ...payload.data, estimated_delivery_date: '2026-08-09T00:00:00Z' },
  });
  assert.equal(original.event_key, same.event_key);
  assert.notEqual(original.event_key, distinct.event_key);
});

test('ShipStation webhook validates constant-time custom token and RSA before ingest', async () => {
  let verifies = 0;
  let ingests = 0;
  const handler = createShipStationWebhookHandler({
    verifySignature: async () => { verifies += 1; return true; },
    ingest: async (_env, raw, update) => {
      ingests += 1;
      assert.equal(JSON.parse(raw).data.tracking_number, update.tracking_number);
      return { data: 'event-id', error: null };
    },
  });
  const env = { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token' };
  assert.equal((await handler({ request: request('wrong'), env })).status, 401);
  assert.equal(verifies, 0);
  assert.equal(ingests, 0);
  const response = await handler({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(verifies, 1);
  assert.equal(ingests, 1);
});

test('ShipStation webhook rejects forged RSA and retries on durable ingest failure', async () => {
  let ingests = 0;
  let handler = createShipStationWebhookHandler({
    verifySignature: async () => false,
    ingest: async () => { ingests += 1; return { error: null }; },
  });
  const env = { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token' };
  assert.equal((await handler({ request: request(), env })).status, 401);
  assert.equal(ingests, 0);

  handler = createShipStationWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => ({ error: new Error('db unavailable') }),
  });
  const response = await handler({ request: request(), env });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'tracking_ingest_failed' });
});
