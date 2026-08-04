import assert from 'node:assert/strict';
import test from 'node:test';

import { buyOrderLabel, rateOrderShipment } from '../functions/_lib/shipstation-orders.js';

const order = {
  id: '70f81af0-5ae5-4ea7-953b-f612b6e0ed91',
  order_number: 'MST-00000123',
  status: 'paid',
  customer_email: 'buyer@example.com',
  currency: 'usd',
  ship_address: {
    name: 'Buyer Name',
    address: {
      line1: '100 Main Street',
      city: 'Melbourne',
      state: 'FL',
      postal_code: '32901',
      country: 'US',
    },
  },
  order_items: [{ sku: 'VK-HCR-5G', name: 'VertKleen HCR 5 gal', qty: 1, unit_price: 86.52 }],
  shipstation_shipment_id: null,
  shipstation_label_id: null,
  shipstation_label_status: null,
};

test('rateOrderShipment quotes connected carriers and persists provider shipment ID', async () => {
  let sentPayload;
  let persisted;
  const links = [];
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-warehouse-1' },
    {
      order_id: order.id,
      phone: '+1 321-555-0100',
      residential: 'yes',
      packages: [{ weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 }],
      carrier_ids: ['se-ups'],
    },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => order,
      listCarriers: async () => [
        { carrier_id: 'se-ups', carrier_code: 'ups', friendly_name: 'UPS' },
        { carrier_id: 'se-usps', carrier_code: 'stamps_com', friendly_name: 'USPS' },
      ],
      quoteRates: async (_env, payload) => {
        sentPayload = payload;
        return {
          rate_response: {
            shipment_id: 'se-shipment-1',
            rates: [{
              rate_id: 'se-rate-1',
              shipment_id: 'se-shipment-1',
              carrier_id: 'se-ups',
              carrier_code: 'ups',
              carrier_friendly_name: 'UPS',
              service_code: 'ups_ground',
              service_type: 'UPS Ground',
              shipping_amount: { currency: 'usd', amount: 41.22 },
              delivery_days: 3,
              estimated_delivery_date: '2026-08-08T00:00:00Z',
            }],
          },
        };
      },
      persistRate: async (_env, orderId, patch) => { persisted = { orderId, patch }; },
      linkProviderObject: async (_env, link) => { links.push(link); },
      audit: async () => {},
    },
  );

  assert.deepEqual(sentPayload.rate_options.carrier_ids, ['se-ups']);
  assert.equal(sentPayload.shipment.ship_to.phone, '+1 321-555-0100');
  assert.equal(sentPayload.shipment.ship_to.address_residential_indicator, 'yes');
  assert.deepEqual(persisted, {
    orderId: order.id,
    patch: {
      shipstation_shipment_id: 'se-shipment-1',
      shipstation_label_status: 'rated',
      shipstation_error: null,
    },
  });
  assert.deepEqual(result.rates, [{
    rate_id: 'se-rate-1',
    shipment_id: 'se-shipment-1',
    carrier_id: 'se-ups',
    carrier_code: 'ups',
    carrier_name: 'UPS',
    service_code: 'ups_ground',
    service_type: 'UPS Ground',
    amount: 41.22,
    currency: 'usd',
    delivery_days: 3,
    estimated_delivery_date: '2026-08-08T00:00:00Z',
  }]);
  assert.deepEqual(links, [{
    orderId: order.id,
    provider: 'shipstation',
    objectType: 'shipment',
    providerObjectId: 'se-shipment-1',
    metadata: { order_number: order.order_number },
  }]);
});

test('rateOrderShipment rejects carrier IDs not connected to this API key', async () => {
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-warehouse-1' },
      { order_id: order.id, phone: '+1 321-555-0100', packages: [{ weight: 1 }], carrier_ids: ['se-fake'] },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        quoteRates: async () => assert.fail('invalid carrier must fail before provider quote'),
      },
    ),
    (error) => error.code === 'shipstation_carrier_not_connected',
  );
});

test('rateOrderShipment uses CMS variant package profiles when staff leaves packages blank', async () => {
  let sentPayload;
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-warehouse-1' },
    { order_id: order.id, phone: '+1 321-555-0100' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({ ...order, order_items: [{ ...order.order_items[0], qty: 2 }] }),
      loadPackageProfiles: async () => [
        { weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 },
        { weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 },
      ],
      listCarriers: async () => [{ carrier_id: 'se-ups' }],
      quoteRates: async (_env, payload) => {
        sentPayload = payload;
        return { rate_response: { shipment_id: 'se-shipment-1', rates: [] } };
      },
      persistRate: async () => {},
      linkProviderObject: async () => {},
      audit: async () => {},
    },
  );
  assert.equal(sentPayload.shipment.packages.length, 2);
  assert.equal(sentPayload.shipment.packages[0].weight.value, 42.5);
  assert.equal(result.packages_source, 'cms');
});

test('buyOrderLabel verifies rate ownership, then atomically claims and persists label', async () => {
  const calls = [];
  let persisted;
  const links = [];
  const result = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, rate_id: 'se-rate-1' },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
      getRate: async () => ({ rate_id: 'se-rate-1', shipment_id: 'se-shipment-1' }),
      claimLabel: async () => { calls.push('claim'); return true; },
      purchaseLabel: async (_env, rateId, body) => {
        calls.push(['purchase', rateId, body]);
        return {
          label_id: 'se-label-1',
          shipment_id: 'se-shipment-1',
          status: 'completed',
          carrier_id: 'se-ups',
          service_code: 'ups_ground',
          tracking_number: '1Z999AA10123456784',
          tracking_url: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
          shipment_cost: { currency: 'usd', amount: 41.22 },
          label_download: { pdf: 'https://api.shipstation.com/v2/downloads/label.pdf' },
        };
      },
      persistLabel: async (_env, orderId, patch) => { persisted = { orderId, patch }; },
      linkProviderObject: async (_env, link) => { links.push(link); },
      insertShipmentEvent: async () => {},
      audit: async () => {},
    },
  );

  assert.equal(calls[0], 'claim');
  assert.deepEqual(calls[1][2], {
    validate_address: 'validate_and_clean',
    label_layout: '4x6',
    label_format: 'pdf',
    label_download_type: 'url',
    display_scheme: 'label',
  });
  assert.equal(persisted.orderId, order.id);
  assert.equal(persisted.patch.shipstation_label_id, 'se-label-1');
  assert.equal(persisted.patch.shipstation_label_status, 'label_purchased');
  assert.equal(persisted.patch.tracking_status, 'packing');
  assert.equal(persisted.patch.shipped_at, undefined);
  assert.equal(result.label_url, 'https://api.shipstation.com/v2/downloads/label.pdf');
  assert.equal(result.already_purchased, false);
  assert.deepEqual(links.map((link) => [link.objectType, link.providerObjectId]), [
    ['shipment', 'se-shipment-1'],
    ['rate', 'se-rate-1'],
    ['label', 'se-label-1'],
  ]);
});

test('buyOrderLabel blocks shipment mismatch before claim or charge', async () => {
  let claimed = false;
  await assert.rejects(
    buyOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, rate_id: 'se-rate-1' },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
        getRate: async () => ({ rate_id: 'se-rate-1', shipment_id: 'se-other-shipment' }),
        claimLabel: async () => { claimed = true; return true; },
        purchaseLabel: async () => assert.fail('mismatch must never charge'),
      },
    ),
    (error) => error.code === 'shipstation_rate_order_mismatch',
  );
  assert.equal(claimed, false);
});

test('buyOrderLabel is idempotent after a label exists', async () => {
  const links = [];
  const existing = {
    ...order,
    shipstation_shipment_id: 'se-shipment-1',
    shipstation_label_id: 'se-label-existing',
    shipstation_label_status: 'label_purchased',
    shipstation_label_url: 'https://api.shipstation.com/v2/downloads/existing.pdf',
    tracking_number: '9400111899223856928499',
  };
  const result = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, rate_id: 'se-rate-1' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => existing,
      linkProviderObject: async (_env, link) => links.push(link),
      getRate: async () => assert.fail('existing label must return before provider call'),
      claimLabel: async () => assert.fail('existing label must not claim'),
      purchaseLabel: async () => assert.fail('existing label must not charge'),
    },
  );
  assert.equal(result.already_purchased, true);
  assert.equal(result.label_id, 'se-label-existing');
  assert.deepEqual(links.map((link) => [link.objectType, link.providerObjectId]), [
    ['shipment', 'se-shipment-1'],
    ['label', 'se-label-existing'],
  ]);
});

test('buyOrderLabel locks provider error responses for manual reconciliation', async () => {
  let persisted;
  await assert.rejects(
    buyOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, rate_id: 'se-rate-1' },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
        getRate: async () => ({ rate_id: 'se-rate-1', shipment_id: 'se-shipment-1' }),
        claimLabel: async () => true,
        purchaseLabel: async () => ({
          label_id: 'se-label-error',
          shipment_id: 'se-shipment-1',
          status: 'error',
        }),
        persistLabel: async (_env, _id, patch) => { persisted = patch; },
        insertShipmentEvent: async () => assert.fail('failed label must not add packing event'),
        audit: async () => assert.fail('failed label must not record purchase'),
      },
    ),
    (error) => error.code === 'shipstation_label_provider_error',
  );
  assert.equal(persisted.shipstation_label_id, 'se-label-error');
  assert.equal(persisted.shipstation_label_status, 'reconcile_required');
  assert.equal(persisted.tracking_status, undefined);
});
