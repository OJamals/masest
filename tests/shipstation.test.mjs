import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRateRequest,
  configureShipStationTrackingWebhook,
  fetchShipStationLabelTracking,
  normalizePackages,
  shipStationConfig,
  shipStationRequest,
  shipStationStatus,
} from '../functions/_lib/shipstation.js';
import {
  createShipStationWebhookHandler,
  trackingUpdateFromPayload,
} from '../functions/api/shipstation-webhook.js';

test('ShipStation client keeps the API key server-side and authenticates V2 requests', async () => {
  const calls = [];
  const env = {
    SHIPSTATION_API_KEY: 'secret-api-key',
    SHIPSTATION_WAREHOUSE_ID: 'se-warehouse-1',
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ carriers: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const config = shipStationConfig(env);
  assert.deepEqual(config, {
    api_key: 'present',
    warehouse_id: 'se-warehouse-1',
    webhook_token: 'missing',
    ready: true,
  });

  const payload = await shipStationRequest(env, '/carriers', {}, { fetchImpl });
  assert.deepEqual(payload, { carriers: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.shipstation.com/v2/carriers');
  assert.equal(calls[0].options.headers['API-Key'], 'secret-api-key');
  assert.equal(JSON.stringify(config).includes('secret-api-key'), false);
});

test('ShipStation label tracking fetch converges on webhook canonical normalization', async () => {
  const direct = {
    tracking_number: '1Z999AA10123456784',
    status_code: 'DE',
    status_description: 'Delivered',
    estimated_delivery_date: '2026-08-08T00:00:00Z',
    actual_delivery_date: '2026-08-07T16:10:00Z',
    events: [{ occurred_at: '2026-08-07T16:10:00Z', event_code: 'DELIVERED', description: 'Delivered' }],
  };
  const ingestions = [];
  const ingestProviderEvent = async (_sb, descriptor, canonical, effects) => {
    ingestions.push({ descriptor, canonical, effects });
    return { data: 'event-id', error: null };
  };
  const fetched = await fetchShipStationLabelTracking(
    { SHIPSTATION_API_KEY: 'secret' },
    'se-label-1',
    { request: async () => direct, sb: {}, ingestProviderEvent },
  );
  const webhook = await trackingUpdateFromPayload({ resource_type: 'API_TRACK', data: direct });
  assert.deepEqual(fetched, webhook);
  const handler = createShipStationWebhookHandler({
    verifySignature: async () => true,
    trackingIngestDependencies: { sb: {}, ingestProviderEvent },
  });
  const response = await handler({
    env: { SHIPSTATION_WEBHOOK_TOKEN: 'hook-token' },
    request: new Request('https://masest.co/api/shipstation-webhook', {
      method: 'POST',
      headers: { 'x-masest-webhook-token': 'hook-token' },
      body: JSON.stringify({ resource_type: 'API_TRACK', data: direct }),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(ingestions.length, 2);
  assert.deepEqual(ingestions[0], ingestions[1]);
});

test('ShipStation status fails readiness when configured warehouse is unavailable', async () => {
  const env = {
    APP_URL: 'https://masest.co',
    SHIPSTATION_API_KEY: 'api-secret',
    SHIPSTATION_WAREHOUSE_ID: 'se-missing',
    SHIPSTATION_WEBHOOK_TOKEN: 'webhook-secret-with-production-length',
  };
  const status = await shipStationStatus(env, {
    request: async (_env, path) => {
      if (path === '/carriers') return { carriers: [{ carrier_id: 'se-ups', carrier_code: 'ups' }] };
      if (path === '/warehouses') return { warehouses: [] };
      if (path === '/environment/webhooks') return { webhooks: [] };
      throw new Error(`unexpected path ${path}`);
    },
  });
  assert.equal(status.connected, true);
  assert.equal(status.warehouse_match, false);
  assert.equal(status.ready, false);
});

test('ShipStation status reports provider-masked custom headers without claiming verification', async () => {
  const env = {
    APP_URL: 'https://masest.co',
    SHIPSTATION_API_KEY: 'api-secret',
    SHIPSTATION_WAREHOUSE_ID: 'se-main',
    SHIPSTATION_WEBHOOK_TOKEN: 'webhook-secret-with-production-length',
  };
  const status = await shipStationStatus(env, {
    request: async (_env, path) => {
      if (path === '/carriers') return { carriers: [{ carrier_id: 'se-ups', carrier_code: 'ups' }] };
      if (path === '/warehouses') return { warehouses: [{ warehouse_id: 'se-main', name: 'Main' }] };
      if (path === '/environment/webhooks') return { webhooks: [{
        webhook_id: 'se-hook', event: 'track', url: 'https://masest.co/api/shipstation-webhook',
        headers: [{ key: 'X-MASEST-Webhook-Token', value: 'MASKED' }],
      }] };
      throw new Error(`unexpected path ${path}`);
    },
  });
  assert.equal(status.webhook.registered, true);
  assert.equal(status.webhook.authenticated, false);
  assert.equal(status.webhook.authentication, 'provider_masked');
  assert.equal(status.webhook.ready, true);
});

test('ShipStation tracking webhook config sends custom auth header but returns only redacted metadata', async () => {
  const calls = [];
  const env = {
    APP_URL: 'https://masest.co',
    SHIPSTATION_API_KEY: 'api-secret',
    SHIPSTATION_WEBHOOK_TOKEN: 'webhook-secret',
  };
  const result = await configureShipStationTrackingWebhook(env, {
    request: async (_env, path, options = {}) => {
      calls.push({ path, options });
      if (options.method === 'POST') return { webhook_id: 'se-webhook-1' };
      return [];
    },
  });
  assert.equal(calls[1].path, '/environment/webhooks');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(calls[1].options.body.headers, [{
    key: 'X-MASEST-Webhook-Token',
    value: 'webhook-secret',
  }]);
  assert.deepEqual(result, {
    configured: true,
    created: true,
    webhook_id: 'se-webhook-1',
    event: 'track',
    url: 'https://masest.co/api/shipstation-webhook',
  });
  assert.equal(JSON.stringify(result).includes('webhook-secret'), false);
  assert.equal(JSON.stringify(result).includes('api-secret'), false);
});

test('ShipStation tracking webhook config upgrades an existing unauthenticated track hook in place', async () => {
  const calls = [];
  const env = {
    APP_URL: 'https://masest.co',
    SHIPSTATION_API_KEY: 'api-secret',
    SHIPSTATION_WEBHOOK_TOKEN: 'webhook-secret',
  };
  const result = await configureShipStationTrackingWebhook(env, {
    request: async (_env, path, options = {}) => {
      calls.push({ path, options });
      if (!options.method) return [{
        webhook_id: 'se-webhook-existing',
        event: 'track',
        url: 'https://masest.co/api/shipstation-webhook',
        headers: [],
      }];
      return { webhook_id: 'se-webhook-existing' };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, '/environment/webhooks/se-webhook-existing');
  assert.equal(calls[1].options.method, 'PUT');
  assert.deepEqual(calls[1].options.body.headers, [{
    key: 'X-MASEST-Webhook-Token',
    value: 'webhook-secret',
  }]);
  assert.equal(result.created, false);
  assert.equal(JSON.stringify(result).includes('webhook-secret'), false);
});

test('ShipStation client fails closed without configuration and returns sanitized provider errors', async () => {
  await assert.rejects(
    shipStationRequest({}, '/carriers'),
    (error) => error.code === 'shipstation_not_configured' && !String(error).includes('undefined'),
  );

  const apiKey = 'must-never-appear';
  await assert.rejects(
    shipStationRequest(
      { SHIPSTATION_API_KEY: apiKey },
      '/carriers',
      {},
      {
        fetchImpl: async () => new Response(
          JSON.stringify({ message: `provider rejected ${apiKey}` }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      },
    ),
    (error) => {
      assert.equal(error.code, 'shipstation_http_401');
      assert.equal(error.status, 401);
      assert.equal(String(error).includes(apiKey), false);
      return true;
    },
  );
});

test('ShipStation rate requests normalize multi-package dimensions and the Stripe shipping address', () => {
  const packages = normalizePackages([
    { weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 },
    { weight: 9, unit: 'pound' },
  ]);
  assert.deepEqual(packages, [
    {
      package_code: 'package',
      weight: { value: 42.5, unit: 'pound' },
      dimensions: { unit: 'inch', length: 14, width: 14, height: 18 },
    },
    { package_code: 'package', weight: { value: 9, unit: 'pound' } },
  ]);
  assert.throws(
    () => normalizePackages([{ weight: 8, unit: 'pound', length: 12 }]),
    (error) => error.code === 'invalid_package_dimensions',
  );

  const payload = buildRateRequest({
    order: {
      id: '70f81af0-5ae5-4ea7-953b-f612b6e0ed91',
      order_number: 'MST-00000123',
      customer_email: 'buyer@example.com',
      ship_address: {
        name: 'Buyer Name',
        phone: '+1 321-555-0100',
        address: {
          line1: '100 Main Street',
          line2: 'Suite 200',
          city: 'Melbourne',
          state: 'FL',
          postal_code: '32901',
          country: 'US',
        },
      },
      order_items: [{ sku: 'VK-HCR-5G', name: 'VertKleen HCR 5 gal', qty: 1, unit_price: 86.52 }],
    },
    packages,
    warehouseId: 'se-warehouse-1',
    carrierIds: ['se-ups', 'se-fedex'],
  });

  assert.deepEqual(payload.rate_options, { carrier_ids: ['se-ups', 'se-fedex'] });
  assert.equal(payload.shipment.external_shipment_id, undefined);
  assert.equal(payload.shipment.shipment_number, 'MST-00000123');
  assert.equal(payload.shipment.warehouse_id, 'se-warehouse-1');
  assert.deepEqual(payload.shipment.ship_to, {
    name: 'Buyer Name',
    phone: '+1 321-555-0100',
    email: 'buyer@example.com',
    address_line1: '100 Main Street',
    address_line2: 'Suite 200',
    city_locality: 'Melbourne',
    state_province: 'FL',
    postal_code: '32901',
    country_code: 'US',
    address_residential_indicator: 'unknown',
  });
  assert.deepEqual(payload.shipment.packages, packages);
});
