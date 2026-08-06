import assert from 'node:assert/strict';
import test from 'node:test';

import { buyOrderLabel, rateOrderShipment, voidOrderLabel } from '../functions/_lib/shipstation-orders.js';

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
  shipstation_cost: null,
  tracking_status: 'processing',
};

const normalizedShipmentId = 'a024352e-2dc8-4a6c-ad44-eb57e7701408';
const shipmentLifecycleDeps = {
  claimShipmentOperation: async () => ({
    claimed: true,
    id: normalizedShipmentId,
    revision: 0,
    external_shipment_id: 'masest-order-default-0',
  }),
  finalizeShipmentOperation: async () => ({ applied: true, revision: 0, status: 'rated' }),
  failShipmentOperation: async () => assert.fail('successful rate must not enter reconciliation'),
};
const selectedRateSnapshot = {
  selected: true,
  order_shipment_id: normalizedShipmentId,
  shipment_id: 'se-shipment-1',
  revision: 0,
  amount_minor: 4122,
  currency: 'usd',
  currency_exponent: 2,
};
const labelInput = (rateId = 'se-rate-1') => ({
  order_id: order.id,
  order_shipment_id: normalizedShipmentId,
  expected_revision: 0,
  shipment_id: 'se-shipment-1',
  rate_id: rateId,
});
const providerRate = {
  rate_id: 'se-rate-1',
  shipment_id: 'se-shipment-1',
  shipping_amount: { currency: 'usd', amount: 41.22 },
};

test('rateOrderShipment quotes connected carriers and atomically finalizes provider shipment ID', async () => {
  let sentPayload;
  let finalized;
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    {
      order_id: order.id,
      phone: '+1 321-555-0100',
      residential: 'yes',
      packages: [{ weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 }],
      carrier_ids: ['se-ups'],
    },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      ...shipmentLifecycleDeps,
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
      finalizeShipmentOperation: async (_env, input) => {
        finalized = input;
        return { applied: true, revision: 0, status: 'rated' };
      },
    },
  );

  assert.deepEqual(sentPayload.rate_options.carrier_ids, ['se-ups']);
  assert.equal(sentPayload.shipment.ship_to.phone, '+1 321-555-0100');
  assert.equal(sentPayload.shipment.ship_to.address_residential_indicator, 'yes');
  assert.equal(sentPayload.shipment.external_shipment_id, 'masest-order-default-0');
  assert.equal(finalized.orderShipmentId, normalizedShipmentId);
  assert.equal(finalized.providerShipmentId, 'se-shipment-1');
  assert.equal(finalized.status, 'rated');
  assert.match(finalized.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(finalized.packages.length, 1);
  assert.equal(finalized.rates.length, 1);
  assert.deepEqual(result.rates, [{
    rate_id: 'se-rate-1',
    shipment_id: 'se-shipment-1',
    carrier_id: 'se-ups',
    carrier_code: 'ups',
    carrier_name: 'UPS',
    service_code: 'ups_ground',
    service_type: 'UPS Ground',
    amount: 41.22,
    amount_minor: 4122,
    currency: 'usd',
    currency_exponent: 2,
    delivery_days: 3,
    estimated_delivery_date: '2026-08-08T00:00:00Z',
  }]);
});

test('rateOrderShipment rejects carrier IDs not connected to this API key', async () => {
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
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

test('rateOrderShipment rejects multi-package carriers without an explicitly supported service', async () => {
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      {
        order_id: order.id,
        packages: [{ weight: 1 }, { weight: 1 }],
        carrier_ids: ['se-ups'],
      },
      {},
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups', services: [] }],
        claimShipmentOperation: async () => assert.fail('unsupported carrier must fail before claim'),
        quoteRates: async () => assert.fail('unsupported carrier must fail before provider quote'),
      },
    ),
    (error) => error.code === 'shipstation_multi_package_unsupported',
  );
});

test('rateOrderShipment persists only service-confirmed multi-package rates', async () => {
  let finalized;
  await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    {
      order_id: order.id,
      phone: '+1 321-555-0100',
      packages: [{ weight: 1 }, { weight: 1 }],
      carrier_ids: ['se-ups'],
    },
    {},
    {
      ...shipmentLifecycleDeps,
      loadOrder: async () => order,
      listCarriers: async () => [{
        carrier_id: 'se-ups',
        has_multi_package_supporting_services: true,
        services: [
          { service_code: 'ups_ground', is_multi_package_supported: true },
          { service_code: 'ups_unsupported', is_multi_package_supported: false },
        ],
      }],
      quoteRates: async () => ({ rate_response: {
        shipment_id: 'se-shipment-1',
        rates: [
          {
            rate_id: 'se-rate-supported', shipment_id: 'se-shipment-1', carrier_id: 'se-ups',
            service_code: 'ups_ground', shipping_amount: { currency: 'usd', amount: 20 },
          },
          {
            rate_id: 'se-rate-unsupported', shipment_id: 'se-shipment-1', carrier_id: 'se-ups',
            service_code: 'ups_unsupported', shipping_amount: { currency: 'usd', amount: 10 },
          },
        ],
      } }),
      finalizeShipmentOperation: async (_env, input) => {
        finalized = input;
        return { applied: true, revision: 0, status: 'rated' };
      },
    },
  );
  assert.deepEqual(finalized.rates.map((rate) => rate.rate_id), ['se-rate-supported']);
});

test('rateOrderShipment falls back to catalog package profiles for a partial split', async () => {
  let sentPayload;
  let profiledOrder;
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    {
      order_id: order.id,
      phone: '+1 321-555-0100',
      split_key: 'first-jug',
      split_items: [{ sku: 'VK-HCR-5G', quantity: 1 }],
    },
    { user: { id: 'staff-1' } },
    {
      ...shipmentLifecycleDeps,
      loadOrder: async () => ({ ...order, order_items: [{ ...order.order_items[0], qty: 2 }] }),
      loadPackageProfiles: async (_env, shipmentOrder) => {
        profiledOrder = shipmentOrder;
        return [{ weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 }];
      },
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
  assert.equal(profiledOrder.order_items[0].qty, 1);
  assert.equal(sentPayload.shipment.packages.length, 1);
  assert.equal(sentPayload.shipment.packages[0].weight.value, 42.5);
  // This shipment covers 1 of 2 units, so the whole-order carton plan from checkout does
  // not describe it and packing is recomputed from the variant profiles.
  assert.equal(result.packages_source, 'catalog');
});

test('rateOrderShipment replays the checkout carton plan when the shipment covers the order', async () => {
  const plan = [{
    package_code: 'package',
    weight: { value: 50, unit: 'pound' },
    dimensions: { unit: 'inch', length: 20, width: 10, height: 15 },
  }];
  let sentPayload;
  let profilesLoaded = false;
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    { order_id: order.id, phone: '+1 321-555-0100' },
    { user: { id: 'staff-1' } },
    {
      ...shipmentLifecycleDeps,
      loadOrder: async () => ({ ...order, shipping_package_plan: plan }),
      loadPackageProfiles: async () => { profilesLoaded = true; return []; },
      listCarriers: async () => [{ carrier_id: 'se-ups' }],
      quoteRates: async (_env, payload) => {
        sentPayload = payload;
        return { rate_response: { shipment_id: 'se-shipment-2', rates: [] } };
      },
      persistRate: async () => {},
      linkProviderObject: async () => {},
      audit: async () => {},
    },
  );
  // The buyer paid for this exact carton; re-deriving it would be a second guess.
  assert.equal(profilesLoaded, false);
  assert.equal(result.packages_source, 'checkout_quote');
  assert.equal(sentPayload.shipment.packages.length, 1);
  assert.equal(sentPayload.shipment.packages[0].weight.value, 50);
});

test('rateOrderShipment flags the service the buyer actually paid for', async () => {
  const result = await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    { order_id: order.id, phone: '+1 321-555-0100' },
    { user: { id: 'staff-1' } },
    {
      ...shipmentLifecycleDeps,
      loadOrder: async () => ({
        ...order,
        paid_shipping_carrier_id: 'se-usps',
        paid_shipping_service_code: 'usps_ground_advantage',
      }),
      loadPackageProfiles: async () => [{ weight: 20, unit: 'pound', length: 10, width: 10, height: 12 }],
      listCarriers: async () => [{ carrier_id: 'se-usps' }],
      quoteRates: async () => ({
        rate_response: {
          shipment_id: 'se-shipment-3',
          rates: [
            { rate_id: 'r1', carrier_id: 'se-usps', service_code: 'usps_priority', shipping_amount: { amount: 30, currency: 'usd' } },
            { rate_id: 'r2', carrier_id: 'se-usps', service_code: 'usps_ground_advantage', shipping_amount: { amount: 24.5, currency: 'usd' } },
          ],
        },
      }),
      persistRate: async () => {},
      linkProviderObject: async () => {},
      audit: async () => {},
    },
  );
  assert.equal(result.paid_service.matched, true);
  assert.equal(result.rates.find((rate) => rate.paid_service).rate_id, 'r2');
  assert.equal(result.rates.filter((rate) => rate.paid_service).length, 1);
});

test('rateOrderShipment aggregates duplicate order-item SKUs before package lookup and allocation claim', async () => {
  let profiledOrder;
  let claimed;
  const duplicateSkuOrder = {
    ...order,
    order_items: [
      { ...order.order_items[0], qty: 1 },
      { ...order.order_items[0], qty: 2 },
    ],
  };
  await rateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    { order_id: order.id, phone: '+1 321-555-0100' },
    { user: { id: 'staff-1' } },
    {
      ...shipmentLifecycleDeps,
      loadOrder: async () => duplicateSkuOrder,
      loadPackageProfiles: async (_env, shipmentOrder) => {
        profiledOrder = shipmentOrder;
        return [{ weight: 48, unit: 'pound' }];
      },
      listCarriers: async () => [{ carrier_id: 'se-ups' }],
      claimShipmentOperation: async (_env, input) => {
        claimed = input;
        return shipmentLifecycleDeps.claimShipmentOperation();
      },
      quoteRates: async () => ({ rate_response: { shipment_id: 'se-shipment-1', rates: [] } }),
    },
  );
  assert.deepEqual(profiledOrder.order_items.map(({ sku, qty }) => ({ sku, qty })), [
    { sku: 'VK-HCR-5G', qty: 3 },
  ]);
  assert.deepEqual(claimed.pendingPayload.items, [{ sku: 'VK-HCR-5G', quantity: 3 }]);
});

test('rateOrderShipment requires Masest warehouse se-2287981 before provider access', async () => {
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-wrong' },
      { order_id: order.id, phone: '+1 321-555-0100', packages: [{ weight: 1 }] },
      {},
      { loadOrder: async () => assert.fail('warehouse mismatch must fail before order/provider access') },
    ),
    (error) => error.code === 'shipstation_warehouse_mismatch',
  );
});

test('rateOrderShipment locks uncertain create for reconciliation instead of blind retry', async () => {
  let failure;
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      {
        order_id: order.id,
        phone: '+1 321-555-0100',
        packages: [{ weight: 42.5, unit: 'pound', length: 14, width: 14, height: 18 }],
      },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        claimShipmentOperation: async () => ({
          id: normalizedShipmentId,
          revision: 0,
          external_shipment_id: 'masest-order-default-0',
        }),
        quoteRates: async () => {
          throw Object.assign(new Error('timeout'), { code: 'shipstation_network_failed' });
        },
        failShipmentOperation: async (_env, input) => { failure = input; },
      },
    ),
    (error) => error.code === 'shipstation_network_failed',
  );
  assert.deepEqual(failure, {
    orderShipmentId: normalizedShipmentId,
    expectedRevision: 0,
    errorCode: 'shipstation_network_failed',
    reconcile: true,
  });
});

test('rateOrderShipment releases deterministic provider rejection for corrected retry', async () => {
  let failure;
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      { order_id: order.id, phone: '+1 321-555-0100', packages: [{ weight: 1 }] },
      {},
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        claimShipmentOperation: shipmentLifecycleDeps.claimShipmentOperation,
        quoteRates: async () => {
          throw Object.assign(new Error('invalid address'), { code: 'shipstation_http_400', status: 400 });
        },
        failShipmentOperation: async (_env, input) => { failure = input; },
      },
    ),
    (error) => error.code === 'shipstation_http_400',
  );
  assert.equal(failure.reconcile, false);
});

test('rateOrderShipment reconciles provider conflict through the exact external shipment ID', async () => {
  let failure;
  await assert.rejects(
    rateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      { order_id: order.id, phone: '+1 321-555-0100', packages: [{ weight: 1 }] },
      {},
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        claimShipmentOperation: shipmentLifecycleDeps.claimShipmentOperation,
        quoteRates: async (_env, payload) => {
          assert.equal(payload.shipment.external_shipment_id, 'masest-order-default-0');
          throw Object.assign(new Error('duplicate external shipment'), {
            code: 'shipstation_http_409', status: 409,
          });
        },
        failShipmentOperation: async (_env, input) => { failure = input; },
      },
    ),
    (error) => error.code === 'shipstation_http_409',
  );
  assert.equal(failure.reconcile, true);
  assert.equal(failure.orderShipmentId, normalizedShipmentId);
});

test('buyOrderLabel purchases a selected nondefault shipment even when legacy order projection points elsewhere', async () => {
  const calls = [];
  let persisted;
  const financialEntries = [];
  const links = [];
  const result = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    labelInput(),
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-legacy-shipment' }),
      verifySelectedRate: async () => selectedRateSnapshot,
      getRate: async () => providerRate,
      claimLabel: async (_env, input) => { calls.push(['claim', input]); return true; },
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
      recordFinancialEntry: async (_env, entry) => { financialEntries.push(entry); },
      insertShipmentEvent: async () => {},
      audit: async () => {},
    },
  );

  assert.deepEqual(calls[0], ['claim', {
    orderId: order.id,
    orderShipmentId: normalizedShipmentId,
    expectedRevision: 0,
    rateId: 'se-rate-1',
  }]);
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
  assert.equal('label_url' in result, false);
  assert.doesNotMatch(JSON.stringify(result), /api\.shipstation\.com\/v2\/downloads/);
  assert.equal(result.already_purchased, false);
  assert.deepEqual(links.map((link) => [link.objectType, link.providerObjectId]), [
    ['shipment', 'se-shipment-1'],
    ['rate', 'se-rate-1'],
    ['label', 'se-label-1'],
  ]);
  assert.deepEqual(links[2].metadata, {
    order_number: order.order_number,
    order_shipment_id: normalizedShipmentId,
    revision: 0,
    shipment_id: 'se-shipment-1',
    rate_id: 'se-rate-1',
    status: 'label_purchased',
    tracking_number: '1Z999AA10123456784',
    tracking_url: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    carrier: 'se-ups',
    cost: 41.22,
    currency: 'usd',
  });
  assert.deepEqual(financialEntries, [{
    orderId: order.id,
    source: 'shipstation',
    entryType: 'postage_purchase',
    providerObjectId: 'se-label-1',
    amount: 41.22,
    currency: 'usd',
    state: 'recognized',
    actorId: 'staff-1',
    reason: null,
    metadata: { shipment_id: 'se-shipment-1', rate_id: 'se-rate-1' },
  }]);
});

test('buyOrderLabel blocks shipment mismatch before claim or charge', async () => {
  let claimed = false;
  await assert.rejects(
    buyOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      labelInput(),
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
        verifySelectedRate: async () => selectedRateSnapshot,
        getRate: async () => ({ ...providerRate, shipment_id: 'se-other-shipment' }),
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
  const financialEntries = [];
  const existing = {
    ...order,
    shipstation_shipment_id: 'se-shipment-1',
    shipstation_label_id: 'se-label-existing',
    shipstation_label_status: 'label_purchased',
    shipstation_label_url: 'https://api.shipstation.com/v2/downloads/existing.pdf',
    tracking_number: '9400111899223856928499',
    shipstation_cost: 12.34,
  };
  const result = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    labelInput(),
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => existing,
      verifySelectedRate: async () => selectedRateSnapshot,
      linkProviderObject: async (_env, link) => links.push(link),
      recordFinancialEntry: async (_env, entry) => financialEntries.push(entry),
      getRate: async () => assert.fail('existing label must return before provider call'),
      claimLabel: async () => assert.fail('existing label must not claim'),
      purchaseLabel: async () => assert.fail('existing label must not charge'),
    },
  );
  assert.equal(result.already_purchased, true);
  assert.equal(result.label_id, 'se-label-existing');
  assert.equal('label_url' in result, false);
  assert.doesNotMatch(JSON.stringify(result), /api\.shipstation\.com\/v2\/downloads/);
  assert.deepEqual(links.map((link) => [link.objectType, link.providerObjectId]), [
    ['shipment', 'se-shipment-1'],
    ['rate', 'se-rate-1'],
    ['label', 'se-label-existing'],
  ]);
  assert.equal(financialEntries.length, 1, 'retry repairs missing purchase ledger evidence');
  assert.equal(financialEntries[0].entryType, 'postage_purchase');
  assert.equal(financialEntries[0].amount, 12.34);
});

test('buyOrderLabel permits one active label per normalized split and retries the exact linked split idempotently', async () => {
  const otherShipmentId = 'cc20e770-d601-4e22-8b49-35ec1242f5fd';
  const projection = {
    ...order,
    shipstation_order_shipment_id: otherShipmentId,
    shipstation_shipment_id: 'se-shipment-other',
    shipstation_label_id: 'se-label-other',
    shipstation_label_status: 'label_purchased',
    order_provider_links: [{
      provider: 'shipstation',
      object_type: 'label',
      provider_object_id: 'se-label-other',
      metadata: { order_shipment_id: otherShipmentId, shipment_id: 'se-shipment-other', status: 'label_purchased' },
    }],
    order_financial_entries: [],
  };
  let charged = 0;
  const first = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    labelInput(),
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => projection,
      verifySelectedRate: async () => selectedRateSnapshot,
      getRate: async () => providerRate,
      claimLabel: async () => true,
      purchaseLabel: async () => {
        charged += 1;
        return { label_id: 'se-label-split-b', shipment_id: 'se-shipment-1', status: 'completed', shipment_cost: { currency: 'usd', amount: 41.22 } };
      },
      persistLabel: async () => {},
      linkProviderObject: async () => {},
      recordFinancialEntry: async () => {},
      insertShipmentEvent: async () => {},
      audit: async () => {},
    },
  );
  assert.equal(first.label_id, 'se-label-split-b');
  assert.equal(charged, 1);

  const linkedRetry = {
    ...projection,
    order_provider_links: [...projection.order_provider_links, {
      provider: 'shipstation',
      object_type: 'label',
      provider_object_id: 'se-label-split-b',
      metadata: {
        order_shipment_id: normalizedShipmentId,
        shipment_id: 'se-shipment-1',
        rate_id: 'se-rate-1',
        status: 'label_purchased',
        cost: 41.22,
        currency: 'usd',
      },
    }],
  };
  let verifiedRetries = 0;
  const retry = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    labelInput(),
    {},
    {
      loadOrder: async () => linkedRetry,
      linkProviderObject: async () => {},
      recordFinancialEntry: async () => {},
      verifySelectedRate: async () => {
        verifiedRetries += 1;
        return selectedRateSnapshot;
      },
      getRate: async () => assert.fail('verified linked split retry must not refetch provider rate'),
      purchaseLabel: async () => assert.fail('linked split retry must not charge'),
    },
  );
  assert.equal(retry.already_purchased, true);
  assert.equal(retry.label_id, 'se-label-split-b');
  assert.equal(verifiedRetries, 1);
  assert.equal(charged, 1);
});

test('buyOrderLabel blocks changed provider money before claim or charge', async () => {
  let claimed = false;
  await assert.rejects(
    buyOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      labelInput(),
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
        verifySelectedRate: async () => selectedRateSnapshot,
        getRate: async () => ({ ...providerRate, shipping_amount: { currency: 'cad', amount: 41.22 } }),
        claimLabel: async () => { claimed = true; return true; },
        purchaseLabel: async () => assert.fail('changed rate must never charge'),
      },
    ),
    (error) => error.code === 'shipstation_rate_snapshot_mismatch',
  );
  assert.equal(claimed, false);
});

test('buyOrderLabel rejects missing or malformed provider currency before claim or charge', async () => {
  for (const currency of [undefined, 'US_DOLLARS']) {
    let claimed = false;
    const shippingAmount = { amount: 41.22 };
    if (currency !== undefined) shippingAmount.currency = currency;
    await assert.rejects(
      buyOrderLabel(
        { SHIPSTATION_API_KEY: 'secret' },
        labelInput(),
        { user: { id: 'staff-1' } },
        {
          loadOrder: async () => order,
          verifySelectedRate: async () => selectedRateSnapshot,
          getRate: async () => ({ ...providerRate, shipping_amount: shippingAmount }),
          claimLabel: async () => { claimed = true; return true; },
          purchaseLabel: async () => assert.fail('malformed currency must never charge'),
        },
      ),
      (error) => error.code === 'shipstation_rate_response_invalid',
    );
    assert.equal(claimed, false);
  }
});

test('buyOrderLabel locks provider error responses for manual reconciliation', async () => {
  let persisted;
  await assert.rejects(
    buyOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      labelInput(),
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_shipment_id: 'se-shipment-1' }),
        verifySelectedRate: async () => selectedRateSnapshot,
        getRate: async () => providerRate,
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

const labeledOrder = {
  ...order,
  shipstation_shipment_id: 'se-shipment-1',
  shipstation_rate_id: 'se-rate-1',
  shipstation_label_id: 'se-label-1',
  shipstation_label_status: 'label_purchased',
  shipstation_label_url: 'https://api.shipstation.com/v2/downloads/label.pdf',
  shipstation_cost: 41.22,
  tracking_status: 'packing',
  carrier: 'ups',
  tracking_number: '1Z999AA10123456784',
  tracking_url: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
};

test('voidOrderLabel claims once, confirms provider void, and records pending refund evidence', async () => {
  const calls = [];
  let finalized;
  let audit;
  const result = await voidOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Wrong package selected' },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => labeledOrder,
      claimVoid: async () => { calls.push('claim'); return true; },
      voidLabel: async (_env, labelId) => { calls.push(['provider', labelId]); return { approved: true, message: 'Label voided' }; },
      finalizeVoid: async (_env, input) => { finalized = input; calls.push(['finalize', input]); },
      audit: async (_env, _context, action, id, detail) => { audit = { action, id, detail }; },
    },
  );

  assert.deepEqual(calls.slice(0, 2), ['claim', ['provider', 'se-label-1']]);
  assert.deepEqual(finalized, {
    orderId: order.id,
    labelId: 'se-label-1',
    actorId: 'staff-1',
    reason: 'Wrong package selected',
    providerMessage: 'Label voided',
  });
  assert.equal(audit.action, 'shipstation_label_voided');
  assert.equal(result.already_voided, false);
  assert.equal(result.refund_state, 'pending');
});

test('voidOrderLabel accepts an exact linked split label even when legacy projection points to another split', async () => {
  let claimed = false;
  const result = await voidOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, label_id: 'se-label-split-a', confirm: true, reason: 'Cancel first split label' },
    {},
    {
      loadOrder: async () => ({
        ...order,
        shipstation_label_id: 'se-label-split-b',
        shipstation_label_status: 'label_purchased',
        order_provider_links: [{
          provider: 'shipstation',
          object_type: 'label',
          provider_object_id: 'se-label-split-a',
          metadata: { order_shipment_id: normalizedShipmentId, shipment_id: 'se-shipment-1' },
        }],
        order_financial_entries: [],
      }),
      claimVoid: async () => { claimed = true; return true; },
      voidLabel: async () => ({ approved: true }),
      finalizeVoid: async () => ({ applied: true }),
      audit: async () => {},
    },
  );
  assert.equal(claimed, true);
  assert.equal(result.label_id, 'se-label-split-a');
});

test('voidOrderLabel is idempotent after same label is voided', async () => {
  const result = await voidOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Retry after timeout' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({ ...labeledOrder, shipstation_label_status: 'label_voided' }),
      finalizeVoid: async () => {},
      claimVoid: async () => assert.fail('already voided must not claim'),
      voidLabel: async () => assert.fail('already voided must not call provider'),
    },
  );
  assert.equal(result.already_voided, true);
  assert.equal(result.label_id, 'se-label-1');
});

test('voidOrderLabel blocks carrier movement before claim/provider access', async () => {
  let claimed = false;
  await assert.rejects(
    voidOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Customer changed address' },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...labeledOrder, tracking_status: 'in_transit' }),
        claimVoid: async () => { claimed = true; return true; },
        voidLabel: async () => assert.fail('moving shipment must not call provider'),
      },
    ),
    (error) => error.code === 'shipstation_label_void_blocked',
  );
  assert.equal(claimed, false);
});

test('voidOrderLabel records rejected and ambiguous provider outcomes without refund evidence', async () => {
  for (const fixture of [
    { provider: async () => ({ approved: false, message: 'Carrier denied void' }), code: 'shipstation_label_void_rejected', state: 'label_void_failed' },
    { provider: async () => { throw Object.assign(new Error('bad request'), { code: 'shipstation_http_400', status: 400 }); }, code: 'shipstation_http_400', state: 'void_reconcile_required' },
    { provider: async () => { throw Object.assign(new Error('conflict'), { code: 'shipstation_http_409', status: 409 }); }, code: 'shipstation_http_409', state: 'void_reconcile_required' },
    { provider: async () => { throw Object.assign(new Error('throttled'), { code: 'shipstation_http_429', status: 429 }); }, code: 'shipstation_http_429', state: 'void_reconcile_required' },
    { provider: async () => { throw Object.assign(new Error('provider timeout'), { code: 'shipstation_http_503', status: 503 }); }, code: 'shipstation_http_503', state: 'void_reconcile_required' },
  ]) {
    let persisted;
    let finalizeCalls = 0;
    await assert.rejects(
      voidOrderLabel(
        { SHIPSTATION_API_KEY: 'secret' },
        { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Duplicate shipment label' },
        { user: { id: 'staff-1' } },
        {
          loadOrder: async () => labeledOrder,
          claimVoid: async () => true,
          voidLabel: fixture.provider,
          persistLabel: async (_env, _id, patch) => { persisted = patch; },
          finalizeVoid: async () => { finalizeCalls += 1; },
        },
      ),
      (error) => error.code === fixture.code,
    );
    assert.equal(persisted.shipstation_label_status, fixture.state);
    assert.equal(finalizeCalls, 0);
  }
});

test('voidOrderLabel default provider adapter sends exact PUT void request', async () => {
  const originalFetch = globalThis.fetch;
  let providerRequest;
  globalThis.fetch = async (url, options) => {
    providerRequest = { url, options };
    return new Response(JSON.stringify({ approved: true, message: 'Accepted' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await voidOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Wrong package selected' },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => labeledOrder,
        claimVoid: async () => true,
        finalizeVoid: async () => {},
        audit: async () => {},
      },
    );
    assert.equal(result.status, 'label_voided');
    assert.equal(providerRequest.url, 'https://api.shipstation.com/v2/labels/se-label-1/void');
    assert.equal(providerRequest.options.method, 'PUT');
    assert.equal(providerRequest.options.headers['API-Key'], 'secret');
    assert.equal(providerRequest.options.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('voidOrderLabel requires confirmation, reason, and exact order label before claim', async () => {
  for (const fixture of [
    { input: { order_id: order.id, label_id: 'se-label-1', confirm: false, reason: 'Wrong package selected' }, code: 'shipstation_label_void_confirmation_required' },
    { input: { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'short' }, code: 'shipstation_label_void_reason_required' },
  ]) {
    await assert.rejects(
      voidOrderLabel({ SHIPSTATION_API_KEY: 'secret' }, fixture.input, {}, {
        loadOrder: async () => assert.fail('input rejection must precede order read'),
      }),
      (error) => error.code === fixture.code,
    );
  }
  await assert.rejects(
    voidOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, label_id: 'se-label-other', confirm: true, reason: 'Wrong package selected' },
      {},
      {
        loadOrder: async () => labeledOrder,
        claimVoid: async () => assert.fail('mismatch must precede claim'),
      },
    ),
    (error) => error.code === 'shipstation_label_order_mismatch',
  );
});

test('voidOrderLabel retry repairs atomic finalization without a second provider call', async () => {
  let finalized = 0;
  const result = await voidOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, label_id: 'se-label-1', confirm: true, reason: 'Repair pending ledger' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({ ...labeledOrder, shipstation_label_status: 'label_voided' }),
      finalizeVoid: async () => { finalized += 1; },
      claimVoid: async () => assert.fail('already voided must not claim'),
      voidLabel: async () => assert.fail('already voided must not call provider'),
    },
  );
  assert.equal(result.already_voided, true);
  assert.equal(finalized, 1);
});

test('buyOrderLabel permits replacement after a confirmed void', async () => {
  let purchased = false;
  const result = await buyOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    labelInput('se-rate-2'),
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({ ...labeledOrder, shipstation_label_status: 'label_voided' }),
      verifySelectedRate: async () => ({ ...selectedRateSnapshot, amount_minor: 4000 }),
      getRate: async () => ({
        rate_id: 'se-rate-2',
        shipment_id: 'se-shipment-1',
        shipping_amount: { currency: 'usd', amount: 40 },
      }),
      claimLabel: async () => true,
      purchaseLabel: async () => { purchased = true; return { label_id: 'se-label-2', shipment_id: 'se-shipment-1', status: 'completed', shipment_cost: { currency: 'usd', amount: 40 } }; },
      persistLabel: async () => {},
      linkProviderObject: async () => {},
      insertShipmentEvent: async () => {},
      recordFinancialEntry: async () => {},
      audit: async () => {},
    },
  );
  assert.equal(purchased, true);
  assert.equal(result.label_id, 'se-label-2');
});
