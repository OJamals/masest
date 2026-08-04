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
    events: [{ occurred_at: '2026-08-07T16:10:00Z', description: 'Delivered' }],
  },
};

function request(token = 'hook-token', body = payload) {
  return new Request('https://masest.co/api/shipstation-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-masest-webhook-token': token },
    body: JSON.stringify(body),
  });
}

test('tracking webhook payload maps delivered status deterministically', async () => {
  const update = await trackingUpdateFromPayload(payload);
  assert.equal(update.tracking_number, '1Z999AA10123456784');
  assert.equal(update.tracking_status, 'delivered');
  assert.equal(update.note, 'Delivered');
  assert.match(update.event_key, /^[a-f0-9]{64}$/);
});

test('ShipStation webhook authenticates custom header before DB mutation', async () => {
  let calls = 0;
  const handler = createShipStationWebhookHandler({
    applyTrackingUpdate: async () => { calls += 1; return { found: true, applied: true }; },
  });
  const env = { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token' };
  assert.equal((await handler({ request: request('wrong'), env })).status, 401);
  assert.equal(calls, 0);
  const response = await handler({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, matched: true, duplicate: false });
  assert.equal(calls, 1);
});

test('ShipStation webhook acks duplicate and unmatched tracking events idempotently', async () => {
  for (const result of [
    { found: true, applied: false },
    { found: false, applied: false },
  ]) {
    const handler = createShipStationWebhookHandler({ applyTrackingUpdate: async () => result });
    const response = await handler({ request: request(), env: { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.duplicate, result.found && !result.applied);
    assert.equal(body.matched, result.found);
  }
});
