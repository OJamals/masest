// A carrier scan must reach the buyer exactly once per meaningful transition — and never
// when the projection decided the scan changed nothing.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createShipStationWebhookHandler } from '../functions/api/shipstation-webhook.js';
import { ingestShipStationTrackingUpdate } from '../functions/_lib/shipstation-tracking-ingest.js';
import { normalizeShipStationTrackingUpdate } from '../functions/_lib/shipstation-tracking.js';
import { deliverIntegrationEffect, toIntegrationEffectRows } from '../functions/_lib/integration-effects.js';
import { shipmentNotice } from '../functions/_lib/order-email.js';

const trackPayload = (statusCode = 'SH') => ({
  resource_type: 'API_TRACK',
  data: {
    tracking_number: '1Z999AA10123456784',
    status_code: statusCode,
    status_description: 'In transit',
    events: [{ occurred_at: '2026-08-07T16:10:00Z', event_code: 'DEPARTED', description: 'Departed' }],
  },
});

function request(body, token = 'hook-token') {
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

const env = { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token', APP_URL: 'https://masest.co' };

test('a tracking scan enqueues the projection and a notification that depends on it', async () => {
  let captured;
  await ingestShipStationTrackingUpdate(env, await normalizeShipStationTrackingUpdate(trackPayload().data), {
    sb: {},
    ingestProviderEvent: async (_sb, _descriptor, _raw, effects) => {
      captured = toIntegrationEffectRows(effects);
      return { data: {}, error: null };
    },
  });
  assert.deepEqual(captured.map((row) => row.effect_key), ['tracking-projection', 'shipment-notification']);
  // Ordering is not incidental: the email must not be sent before the state is applied.
  assert.equal(captured[1].depends_on_effect_key, 'tracking-projection');
});

test('the notification is skipped when the projection reports no notifiable transition', async () => {
  let sends = 0;
  for (const projection of [
    { notify: false, skipped: 'stale_event' },
    { notify: false, skipped: 'unmatched_order' },
    { applied: false, return_shipment: true, notify: false, order_id: 'o1' },
  ]) {
    const outcome = await deliverIntegrationEffect({
      env,
      sb: {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { provider_result: projection } }) }) }),
          }),
        }),
      },
      effect: {
        id: 'e1',
        event_id: 'ev1',
        provider: 'shipstation',
        effect_type: 'shipment_notification',
        depends_on_effect_key: 'tracking-projection',
        payload: { tracking_number: '1Z', tracking_status: 'shipped' },
      },
    }, { sendEmail: async () => { sends += 1; return true; } });
    assert.equal(outcome.skipped, true);
  }
  assert.equal(sends, 0, 'no email may be sent for a non-transition');
});

test('shipment copy is keyed on the buyer-visible status', () => {
  assert.equal(shipmentNotice('delivered').label, 'delivered');
  assert.match(shipmentNotice('shipped', { carrier: 'UPS', trackingNumber: '1Z9' }).body, /UPS 1Z9/);
  // Shipped without a number must not render "Carrier undefined".
  assert.equal(shipmentNotice('shipped').body, 'Your order has shipped.');
  assert.equal(shipmentNotice('blocked').label, 'on hold');
  assert.equal(shipmentNotice('packing').label, 'packing');
});

test('non-track provider payloads are acknowledged, not rejected', async () => {
  const handler = createShipStationWebhookHandler({
    verifySignature: async () => true,
    ingest: async () => ({ error: null }),
  });
  const response = await handler({ request: request({ resource_type: 'API_LABEL', data: {} }), env });
  // A 4xx here teaches ShipStation to disable the endpoint for every event type.
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, 'unsupported_resource_type');
});

test('an unreachable key service is retryable, not an authentication failure', async () => {
  const handler = createShipStationWebhookHandler({
    verifySignature: async () => 'key_unavailable',
    ingest: async () => ({ error: null }),
  });
  const response = await handler({ request: request(trackPayload()), env });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'signature_keys_unavailable');
});

test('a genuinely bad signature is still rejected', async () => {
  const handler = createShipStationWebhookHandler({
    verifySignature: async () => false,
    ingest: async () => ({ error: null }),
  });
  const response = await handler({ request: request(trackPayload()), env });
  assert.equal(response.status, 401);
});
