import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  cancelOrderShipment,
  reconcileOrderShipment,
  selectOrderShipmentRate,
  stablePackageHash,
  updateOrderShipment,
} from '../functions/_lib/shipstation-orders.js';

const order = {
  id: '70f81af0-5ae5-4ea7-953b-f612b6e0ed91',
  order_number: 'MST-00000123',
  status: 'paid',
  currency: 'usd',
  ship_address: {
    name: 'Buyer',
    phone: '+1 321-555-0100',
    address: {
      line1: '100 Main Street',
      city: 'Melbourne',
      state: 'FL',
      postal_code: '32901',
      country: 'US',
    },
  },
  order_items: [{ sku: 'VK-HCR-5G', name: 'VertKleen HCR 5 gal', qty: 1, unit_price: 86.52 }],
  shipstation_label_id: null,
  shipstation_label_status: 'rated',
};

const packages = [{ weight: 48, unit: 'pound', length: 12, width: 12, height: 16 }];
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('stablePackageHash is order-independent, dimension-sensitive, and bounded', async () => {
  const first = await stablePackageHash(packages);
  const same = await stablePackageHash([{ height: 16, width: 12, length: 12, unit: 'pound', weight: 48 }]);
  const changed = await stablePackageHash([{ ...packages[0], height: 17 }]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, changed);
});

test('updateOrderShipment claims revision, updates provider, and atomically finalizes packages', async () => {
  const calls = [];
  const result = await updateOrderShipment(
    { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
    {
      order_id: order.id,
      order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
      expected_revision: 3,
      phone: '+1 321-555-0100',
      residential: 'no',
      packages,
      reason: 'Correct packed dimensions',
    },
    { user: { id: 'staff-1', email: 'staff@example.com' } },
    {
      loadOrder: async () => order,
      claimShipmentOperation: async (_env, input) => {
        calls.push(['claim', input.operation, input.expectedRevision]);
        return {
          claimed: true,
          id: input.orderShipmentId,
          revision: 3,
          provider_shipment_id: 'se-shipment-1',
          external_shipment_id: 'masest-order-default-1',
        };
      },
      updateShipment: async (_env, shipmentId, payload) => {
        calls.push(['provider', shipmentId, payload]);
        return { shipment_id: shipmentId, shipment_status: 'pending', packages: payload.packages };
      },
      listCarriers: async () => [{ carrier_id: 'se-ups' }],
      quoteRates: async (_env, payload) => {
        calls.push(['rates', payload]);
        return { rate_response: { rates: [{
          rate_id: 'se-rate-2',
          shipment_id: 'se-shipment-1',
          carrier_id: 'se-ups',
          shipping_amount: { currency: 'usd', amount: 44.125 },
        }] } };
      },
      finalizeShipmentOperation: async (_env, input) => {
        calls.push(['finalize', input.status, input.expectedRevision, input.packages.length, input.rates.length]);
        return { applied: true, revision: 4, status: input.status };
      },
      failShipmentOperation: async () => assert.fail('successful update must not fail operation'),
      linkProviderObject: async () => {},
      audit: async () => {},
    },
  );
  assert.deepEqual(calls.map((row) => row[0]), ['claim', 'provider', 'rates', 'finalize']);
  assert.equal(calls[1][1], 'se-shipment-1');
  assert.equal(calls[1][2].warehouse_id, 'se-2287981');
  assert.equal(calls[1][2].packages[0].weight.value, 48);
  assert.deepEqual(calls[2][1], {
    shipment_id: 'se-shipment-1',
    rate_options: { carrier_ids: ['se-ups'] },
  });
  assert.equal(calls[3][4], 1);
  assert.equal(result.revision, 4);
  assert.equal(result.rates[0].amount_minor, 4413);
});

test('updateOrderShipment blocks any active label before claim or provider mutation', async () => {
  await assert.rejects(
    updateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      {
        order_id: order.id,
        order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
        expected_revision: 3,
        packages,
        reason: 'Correct packed dimensions',
      },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => ({ ...order, shipstation_label_id: 'se-label-1', shipstation_label_status: 'label_purchased' }),
        claimShipmentOperation: async () => assert.fail('active label must block claim'),
        updateShipment: async () => assert.fail('active label must block provider mutation'),
      },
    ),
    (error) => error.code === 'shipstation_shipment_locked_by_label',
  );
});

test('updateOrderShipment rejects provider-unsafe package bounds before claim or provider mutation', async () => {
  for (const unsafePackages of [
    [{ weight: 10_001, unit: 'pound' }],
    [{ weight: 1, unit: 'pound', length: 1_001, width: 1, height: 1 }],
  ]) {
    await assert.rejects(
      updateOrderShipment(
        { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
        {
          order_id: order.id,
          order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
          expected_revision: 3,
          packages: unsafePackages,
          reason: 'Reject provider unsafe package',
        },
        {},
        {
          loadOrder: async () => order,
          claimShipmentOperation: async () => assert.fail('unsafe package must fail before claim'),
          updateShipment: async () => assert.fail('unsafe package must fail before provider mutation'),
        },
      ),
      (error) => ['invalid_package_weight', 'invalid_package_dimensions'].includes(error.code),
    );
  }
});

test('cancelOrderShipment requires confirmation/reason and finalizes provider cancellation', async () => {
  await assert.rejects(
    cancelOrderShipment(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408', expected_revision: 4 },
      {},
      { loadOrder: async () => order },
    ),
    (error) => error.code === 'shipstation_confirmation_required',
  );

  const calls = [];
  const result = await cancelOrderShipment(
    { SHIPSTATION_API_KEY: 'secret' },
    {
      order_id: order.id,
      order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
      expected_revision: 4,
      confirm: true,
      reason: 'Customer changed fulfillment plan',
    },
    { user: { id: 'staff-1', email: 'staff@example.com' } },
    {
      loadOrder: async () => order,
      claimShipmentOperation: async () => ({
        claimed: true,
        id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
        revision: 4,
        provider_shipment_id: 'se-shipment-1',
      }),
      cancelShipment: async (_env, shipmentId) => { calls.push(['provider', shipmentId]); return {}; },
      finalizeShipmentOperation: async (_env, input) => {
        calls.push(['finalize', input.status]);
        return { applied: true, revision: 5, status: 'cancelled' };
      },
      failShipmentOperation: async () => assert.fail('successful cancellation must not fail'),
      audit: async () => {},
    },
  );
  assert.deepEqual(calls, [['provider', 'se-shipment-1'], ['finalize', 'cancelled']]);
  assert.equal(result.status, 'cancelled');
});

test('provider timeout leaves update locked for reconciliation', async () => {
  let failed;
  await assert.rejects(
    updateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      {
        order_id: order.id,
        order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
        expected_revision: 3,
        packages,
        reason: 'Correct packed dimensions',
      },
      { user: { id: 'staff-1' } },
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        claimShipmentOperation: async () => ({
          claimed: true,
          id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
          revision: 3,
          provider_shipment_id: 'se-shipment-1',
        }),
        updateShipment: async () => { throw Object.assign(new Error('timeout'), { code: 'shipstation_network_failed' }); },
        failShipmentOperation: async (_env, input) => { failed = input; },
      },
    ),
    (error) => error.code === 'shipstation_network_failed',
  );
  assert.equal(failed.orderShipmentId, 'a024352e-2dc8-4a6c-ad44-eb57e7701408');
  assert.equal(failed.errorCode, 'shipstation_network_failed');
  assert.equal(failed.reconcile, true);
});

test('provider-accepted update stays locked when later rate refresh is rejected', async () => {
  let failed;
  await assert.rejects(
    updateOrderShipment(
      { SHIPSTATION_API_KEY: 'secret', SHIPSTATION_WAREHOUSE_ID: 'se-2287981' },
      {
        order_id: order.id,
        order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
        expected_revision: 3,
        packages,
        reason: 'Correct packed dimensions',
      },
      {},
      {
        loadOrder: async () => order,
        listCarriers: async () => [{ carrier_id: 'se-ups' }],
        claimShipmentOperation: async () => ({
          id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408', revision: 3, provider_shipment_id: 'se-shipment-1',
        }),
        updateShipment: async () => ({ shipment_id: 'se-shipment-1' }),
        quoteRates: async () => {
          throw Object.assign(new Error('bad rate request'), { code: 'shipstation_http_400', status: 400 });
        },
        failShipmentOperation: async (_env, input) => { failed = input; },
      },
    ),
    (error) => error.code === 'shipstation_http_400',
  );
  assert.equal(failed.reconcile, true);
});

test('selectOrderShipmentRate persists exact row revision and rate', async () => {
  let selected;
  const result = await selectOrderShipmentRate(
    { SHIPSTATION_API_KEY: 'secret' },
    {
      order_id: order.id,
      order_shipment_id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
      expected_revision: 4,
      rate_id: 'se-rate-1',
    },
    { user: { id: 'staff-1' } },
    {
      selectShipmentRate: async (_env, input) => {
        selected = input;
        return { selected: true, shipment_id: 'se-shipment-1', rate_id: 'se-rate-1', revision: 4 };
      },
    },
  );
  assert.equal(selected.orderId, order.id);
  assert.equal(selected.rateId, 'se-rate-1');
  assert.equal(result.selected, true);
});

test('reconcileOrderShipment uses exact external-ID lookup and keeps mismatches locked', async () => {
  const state = {
    id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
    order_id: order.id,
    revision: 1,
    operation: 'create',
    operation_state: 'reconcile_required',
    external_shipment_id: 'masest-order-default-1',
    package_hash: await stablePackageHash(packages),
    pending_payload: { packages },
  };
  let finalized;
  const result = await reconcileOrderShipment(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: order.id, order_shipment_id: state.id, confirm: true, reason: 'Repair lost create response' },
    { user: { id: 'staff-1', email: 'staff@example.com' } },
    {
      loadShipmentOperation: async () => state,
      getShipmentByExternalId: async (_env, externalId) => ({
        shipment_id: 'se-shipment-1', external_shipment_id: externalId, packages,
      }),
      listCarriers: async () => [{ carrier_id: 'se-ups' }],
      quoteRates: async () => ({ rate_response: { rates: [{
        rate_id: 'se-rate-1',
        shipment_id: 'se-shipment-1',
        carrier_id: 'se-ups',
        shipping_amount: { currency: 'usd', amount: 39.99 },
      }] } }),
      finalizeShipmentOperation: async (_env, input) => {
        finalized = input;
        return { applied: true, revision: 1, status: 'rated' };
      },
    },
  );
  assert.equal(finalized.providerShipmentId, 'se-shipment-1');
  assert.equal(result.reconciled, true);

  await assert.rejects(
    reconcileOrderShipment(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: order.id, order_shipment_id: state.id, confirm: true, reason: 'Repair lost create response' },
      {},
      {
        loadShipmentOperation: async () => state,
        getShipmentByExternalId: async () => ({
          shipment_id: 'se-shipment-1', external_shipment_id: 'wrong-external-id', packages,
        }),
        listCarriers: async () => assert.fail('mismatch must fail before rating'),
        quoteRates: async () => assert.fail('mismatch must fail before rating'),
        finalizeShipmentOperation: async () => assert.fail('mismatch must not finalize'),
      },
    ),
    (error) => error.code === 'shipstation_shipment_reconciliation_mismatch',
  );
});

test('reconcileOrderShipment rejects mismatched update and cancel provider IDs', async () => {
  for (const operation of ['update', 'cancel']) {
    const state = {
      id: 'a024352e-2dc8-4a6c-ad44-eb57e7701408',
      order_id: order.id,
      revision: 3,
      operation,
      operation_state: 'reconcile_required',
      provider_shipment_id: 'se-shipment-expected',
      package_hash: await stablePackageHash(packages),
      pending_payload: { packages, carrier_ids: ['se-ups'] },
    };
    await assert.rejects(
      reconcileOrderShipment(
        { SHIPSTATION_API_KEY: 'secret' },
        {
          order_id: order.id,
          order_shipment_id: state.id,
          confirm: true,
          reason: `Reject mismatched ${operation}`,
        },
        {},
        {
          loadShipmentOperation: async () => state,
          getShipment: async (_env, shipmentId) => {
            assert.equal(shipmentId, 'se-shipment-expected');
            return { shipment_id: 'se-shipment-other', shipment_status: 'cancelled', packages };
          },
          quoteRates: async () => assert.fail('mismatch must fail before rating'),
          finalizeShipmentOperation: async () => assert.fail('mismatch must not finalize'),
        },
      ),
      (error) => error.code === 'shipstation_shipment_reconciliation_mismatch',
    );
  }
});

test('normalized shipment migration is service-only, revisioned, minor-unit safe, and reversible', async () => {
  const [schema, rollback, base, ordersApi, adminUi, operations] = await Promise.all([
    read('../supabase/schema-shipstation-shipments.sql'),
    read('../supabase/rollback-shipstation-shipments.sql'),
    read('../supabase/schema.sql'),
    read('../functions/api/admin/orders.js'),
    read('../js/admin/orders.js'),
    read('../docs/SHIPSTATION_API_FREE.md'),
  ]);
  for (const table of ['order_shipments', 'order_shipment_packages', 'order_shipment_rates']) {
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(schema, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
  }
  for (const fn of [
    'claim_order_shipment_operation',
    'fail_order_shipment_operation',
    'release_order_shipment_operation',
    'finalize_order_shipment_operation',
    'select_order_shipment_rate',
    'claim_order_shipment_label_purchase',
    'verify_order_shipment_rate',
  ]) {
    assert.match(schema, new RegExp(`function public\\.${fn}`));
    assert.match(schema, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]{0,180}to service_role`));
  }
  assert.match(rollback, /drop function if exists public\.release_order_shipment_operation/);
  assert.doesNotMatch(schema, /grant execute[^;]+to (?:anon|authenticated)/);
  assert.match(schema, /amount_minor\s+bigint/);
  assert.match(schema, /order_shipment_rates[\s\S]+package_hash\s+text not null/);
  assert.match(schema, /r\.package_hash = s\.package_hash/);
  assert.match(schema, /r\.currency = lower\(o\.currency\)/);
  assert.match(schema, /order_shipment_item_conservation_failed/);
  assert.match(schema, /raise exception 'order_shipment_split_exists'/);
  assert.doesNotMatch(schema, /if found then[\s\S]{0,900}provider_shipment_id = null/);
  assert.match(schema, /order_shipments_active_split_uidx[\s\S]+where status <> 'cancelled'/);
  assert.match(schema, /coalesce\(max\(generation\), -1\) \+ 1/);
  assert.match(schema, /v_split_generation::text \|\| ':0'/);
  assert.match(schema, /coalesce\(allocated\.allocated_quantity, 0\) <> required\.required_quantity/);
  assert.match(schema, /existing\.status <> 'cancelled'/);
  assert.match(schema, /purchase\.entry_type = 'postage_purchase'/);
  assert.match(schema, /void_entry\.entry_type = 'postage_void_requested'/);
  assert.match(schema, /link\.metadata->>'shipment_id' = v_shipment\.provider_shipment_id/);
  assert.match(schema, /raise exception 'order_shipment_locked_by_label'/);
  assert.match(schema, /s\.id = p_order_shipment_id/);
  assert.match(schema, /s\.revision = p_expected_revision/);
  assert.match(schema, /operation_state = 'reconcile_required'/);
  assert.match(schema, /order_shipment_package_hash/);
  assert.match(schema, /order_shipments[\s\S]+item_allocations\s+jsonb not null/);
  assert.match(schema, /set item_allocations = allocation\.item_allocations/);
  assert.doesNotMatch(schema, /drop column if exists item_allocations/);
  assert.match(schema, /order_shipment_package_hash\(p_pending_payload->'packages'\)/);
  assert.match(schema, /order_shipment_package_hash\(p_packages\)/);
  assert.match(schema, /pending_payload->'_previous_pending_payload'/);
  assert.match(schema, /status = case when operation = 'create' then 'cancelled' else 'rated' end/);
  assert.match(schema, /order_shipment_finalize_mismatch/);
  assert.match(schema, /v_shipment\.revision <> p_expected_revision/);
  assert.match(schema, /length\(external_shipment_id\) between 1 and 50/);
  assert.match(schema, /substr\(md5\(trim\(p_split_key\)/);
  for (const column of [
    'shipstation_order_shipment_id',
    'shipstation_shipment_revision',
    'shipstation_package_hash',
    'shipstation_shipment_state',
  ]) assert.match(base, new RegExp(`add column if not exists ${column}`));
  assert.match(ordersApi, /order_shipments\(id,split_key,generation,revision/);
  assert.doesNotMatch(ordersApi, /pending_payload/);
  for (const action of [
    'select_shipment_rate',
    'update_shipment',
    'cancel_shipment',
    'reconcile_shipment',
  ]) assert.match(adminUi, new RegExp(`action: '${action}'`));
  assert.match(adminUi, /data-shipstation-split-items/);
  assert.match(adminUi, /shipment\.item_allocations/);
  assert.doesNotMatch(adminUi, /order_shipment_packages\?\.\[0\]\?\.item_allocations/);
  assert.match(adminUi, /detail\.split_key/);
  assert.match(adminUi, /detail\.revision/);
  assert.match(adminUi, /detail\.package_hash/);
  assert.match(adminUi, /detail\.reason/);
  assert.match(operations, /supabase\/schema-shipstation-shipments\.sql/);
  assert.match(adminUi, /shipment_id: rate\.dataset\.shipmentId/);
  assert.match(adminUi, /all linked labels must already be voided/i);
});
