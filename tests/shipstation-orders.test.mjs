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
  const financialEntries = [];
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
      recordFinancialEntry: async (_env, entry) => { financialEntries.push(entry); },
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
  assert.equal('label_url' in result, false);
  assert.doesNotMatch(JSON.stringify(result), /api\.shipstation\.com\/v2\/downloads/);
  assert.equal(result.already_purchased, false);
  assert.deepEqual(links.map((link) => [link.objectType, link.providerObjectId]), [
    ['shipment', 'se-shipment-1'],
    ['rate', 'se-rate-1'],
    ['label', 'se-label-1'],
  ]);
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
    { order_id: order.id, rate_id: 'se-rate-1' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => existing,
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
    ['label', 'se-label-existing'],
  ]);
  assert.equal(financialEntries.length, 1, 'retry repairs missing purchase ledger evidence');
  assert.equal(financialEntries[0].entryType, 'postage_purchase');
  assert.equal(financialEntries[0].amount, 12.34);
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
    { order_id: order.id, rate_id: 'se-rate-2' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({ ...labeledOrder, shipstation_label_status: 'label_voided' }),
      getRate: async () => ({ rate_id: 'se-rate-2', shipment_id: 'se-shipment-1' }),
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
