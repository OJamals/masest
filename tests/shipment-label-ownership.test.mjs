import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  activeOutboundShipmentLabels,
  deriveOrderFulfillment,
  requiredOutboundLabelVoids,
  resolveShipmentLabel,
  shipmentLabelOwnership,
} from '../functions/_lib/shipment-label-ownership.js';
import {
  ShipStationOperationAttemptError,
  runShipStationProviderOperation,
  shipStationOperationKey,
  shipStationRequestFingerprint,
} from '../functions/_lib/shipstation-operation-attempts.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const SPLIT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPLIT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function splitOrder() {
  return {
    id: ORDER_ID,
    status: 'paid',
    order_shipments: [
      { id: SPLIT_A, split_key: 'drums', status: 'rated', item_allocations: [{ sku: 'VK-1', quantity: 1 }] },
      { id: SPLIT_B, split_key: 'pails', status: 'rated', item_allocations: [{ sku: 'VK-2', quantity: 2 }] },
    ],
    order_provider_links: [
      {
        id: 'link-out-a', provider: 'shipstation', object_type: 'label', provider_object_id: 'se-label-a',
        metadata: {
          order_shipment_id: SPLIT_A, shipment_id: 'se-shipment-a', status: 'label_purchased',
          tracking_number: 'TRACK-A', tracking_status: 'shipped', tracking_occurred_at: '2026-08-18T10:00:00Z',
          carrier: 'ups', cost: 10.25, currency: 'usd',
        },
      },
      {
        id: 'link-out-b', provider: 'shipstation', object_type: 'label', provider_object_id: 'se-label-b',
        metadata: {
          order_shipment_id: SPLIT_B, shipment_id: 'se-shipment-b', status: 'label_purchased',
          tracking_number: 'TRACK-B', tracking_status: 'packing', tracking_occurred_at: '2026-08-18T11:00:00Z',
          carrier: 'fedex', cost: 12.5, currency: 'usd',
        },
      },
      {
        id: 'link-return-a', provider: 'shipstation', object_type: 'return_label', provider_object_id: 'se-return-a',
        metadata: {
          outbound_label_id: 'se-label-a', order_shipment_id: SPLIT_A, status: 'return_label_created',
          tracking_number: 'RETURN-A', cost: 8.75, currency: 'usd', charge_event: 'carrier_default',
        },
      },
      {
        id: 'orphan', provider: 'shipstation', object_type: 'label', provider_object_id: 'se-orphan',
        metadata: {
          order_shipment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          shipment_id: 'se-shipment-a',
          status: 'label_purchased',
        },
      },
    ],
    order_financial_entries: [
      { source: 'shipstation', entry_type: 'postage_purchase', provider_object_id: 'se-label-a', amount: 10.25, currency: 'usd', recognition_state: 'recognized' },
      { source: 'shipstation', entry_type: 'postage_purchase', provider_object_id: 'se-label-b', amount: 12.5, currency: 'usd', recognition_state: 'recognized' },
      { source: 'shipstation', entry_type: 'postage_return_label', provider_object_id: 'se-return-a', amount: 8.75, currency: 'usd', recognition_state: 'pending' },
    ],
  };
}

test('ownership resolves outbound and return labels to exact non-cancelled split shipments', () => {
  const ownership = shipmentLabelOwnership(splitOrder());

  assert.deepEqual(ownership.labels.map((label) => label.label_id), ['se-label-a', 'se-label-b', 'se-return-a']);
  assert.deepEqual(ownership.outbound.map((label) => label.order_shipment_id), [SPLIT_A, SPLIT_B]);
  assert.equal(ownership.returns[0].parent_label_id, 'se-label-a');
  assert.equal(ownership.returns[0].order_shipment_id, SPLIT_A);
  assert.equal(ownership.returns[0].financial_evidence.recognition_state, 'pending');
  assert.equal(resolveShipmentLabel(splitOrder(), 'se-return-a', { kind: 'return' }).label_id, 'se-return-a');
  assert.equal(resolveShipmentLabel(splitOrder(), 'se-orphan'), null, 'orphan provider links are not authority');
});

test('void evidence deactivates only its exact outbound label', () => {
  const order = splitOrder();
  order.order_financial_entries.push({
    source: 'shipstation', entry_type: 'postage_void_requested', provider_object_id: 'se-label-a',
    amount: -10.25, currency: 'usd', recognition_state: 'pending',
  });

  assert.deepEqual(activeOutboundShipmentLabels(order).map((label) => label.label_id), ['se-label-b']);
  assert.deepEqual(requiredOutboundLabelVoids(order), [{
    order_id: ORDER_ID,
    order_shipment_id: SPLIT_B,
    label_id: 'se-label-b',
    provider_link_id: 'link-out-b',
    tracking_status: 'packing',
    effect_key: `shipstation-label-void:${ORDER_ID}:se-label-b`,
  }]);
  assert.equal(resolveShipmentLabel(order, 'se-label-a', { kind: 'outbound' }).active, false);
});

test('one split scan never fulfills unrelated shipments', () => {
  const partial = deriveOrderFulfillment(splitOrder());
  assert.equal(partial.complete, false);
  assert.equal(partial.tracking_status, 'packing');
  assert.deepEqual(partial.pending_shipment_ids, [SPLIT_B]);

  const shipped = splitOrder();
  shipped.order_provider_links[1].metadata.tracking_status = 'shipped';
  const allShipped = deriveOrderFulfillment(shipped);
  assert.equal(allShipped.complete, true);
  assert.equal(allShipped.tracking_status, 'shipped');

  shipped.order_provider_links[0].metadata.tracking_status = 'delivered';
  shipped.order_provider_links[1].metadata.tracking_status = 'delivered';
  const delivered = deriveOrderFulfillment(shipped);
  assert.equal(delivered.complete, true);
  assert.equal(delivered.tracking_status, 'delivered');
});

test('a required split without an active label cannot be fulfilled', () => {
  const order = splitOrder();
  order.order_provider_links = order.order_provider_links.filter((link) => link.provider_object_id !== 'se-label-b');

  const state = deriveOrderFulfillment(order);
  assert.equal(state.complete, false);
  assert.deepEqual(state.pending_shipment_ids, [SPLIT_B]);
  assert.equal(state.tracking_status, 'packing');
});

function attemptLedger() {
  const rows = new Map();
  return {
    rows,
    async claim(input) {
      const existing = rows.get(input.operationKey);
      if (existing?.status === 'completed') return { state: 'completed', result_summary: existing.result };
      if (existing?.status === 'provider_succeeded') return { state: 'provider_succeeded', result_summary: existing.result };
      if (existing?.status === 'reconcile_required') return { state: 'reconcile_required' };
      rows.set(input.operationKey, { status: 'claimed', lease_owner: input.leaseOwner });
      return { state: 'claimed', lease_owner: input.leaseOwner };
    },
    async providerSucceeded(input) {
      rows.set(input.operationKey, { status: 'provider_succeeded', result: input.resultSummary });
    },
    async complete(input) {
      rows.set(input.operationKey, { status: 'completed', result: input.resultSummary });
    },
    async reconcile(input) {
      rows.set(input.operationKey, { status: 'reconcile_required', error_code: input.errorCode });
    },
    async release(input) {
      rows.set(input.operationKey, { status: 'released', error_code: input.errorCode });
    },
  };
}

test('provider success followed by local crash never repeats the mutation', async () => {
  for (const operation of [
    'shipment_create', 'shipment_update', 'shipment_cancel',
    'label_purchase', 'label_void', 'label_return',
  ]) {
    const ledger = attemptLedger();
    const operationKey = shipStationOperationKey({
      operation, orderId: ORDER_ID, orderShipmentId: SPLIT_A,
      revision: 3, discriminator: `fixture-${operation}`,
    });
    let providerCalls = 0;

    await assert.rejects(
      runShipStationProviderOperation({
        operationKey,
        leaseOwner: 'worker-a',
        attemptAdapter: ledger,
        callProvider: async () => { providerCalls += 1; return { provider_object_id: `se-${operation}` }; },
        summarizeProviderResult: (value) => ({ provider_object_id: value.provider_object_id }),
        finalize: async () => { throw new Error('database unavailable'); },
      }),
      /database unavailable/,
    );
    assert.equal(providerCalls, 1, `${operation} initial call count`);
    assert.equal(ledger.rows.get(operationKey).status, 'provider_succeeded');

    await assert.rejects(
      runShipStationProviderOperation({
        operationKey,
        leaseOwner: 'worker-b',
        attemptAdapter: ledger,
        callProvider: async () => { providerCalls += 1; },
        summarizeProviderResult: () => ({}),
        finalize: async () => assert.fail('replay must reconcile before finalization'),
      }),
      (error) => error instanceof ShipStationOperationAttemptError
        && error.code === 'shipstation_operation_reconciliation_required',
    );
    assert.equal(providerCalls, 1, `${operation} replay call count`);
  }
});

test('unsafe provider summaries preserve the provider-success fence', async () => {
  for (const unsafeSummary of [
    { document: 'https://provider.example/label.pdf' },
    { detail: 'x'.repeat(5000) },
  ]) {
    const ledger = attemptLedger();
    const operationKey = shipStationOperationKey({
      operation: 'label_purchase', orderId: ORDER_ID, orderShipmentId: SPLIT_A,
      revision: 3, discriminator: String(JSON.stringify(unsafeSummary).length),
    });
    await assert.rejects(
      runShipStationProviderOperation({
        operationKey,
        leaseOwner: 'worker-summary',
        attemptAdapter: ledger,
        callProvider: async () => ({ label_id: 'se-label-summary' }),
        summarizeProviderResult: () => unsafeSummary,
        finalize: async () => assert.fail('unsafe provider summary cannot finalize'),
      }),
      (error) => error instanceof ShipStationOperationAttemptError
        && error.code === 'shipstation_operation_summary_invalid',
    );
    assert.equal(ledger.rows.get(operationKey).status, 'provider_succeeded');
    assert.deepEqual(ledger.rows.get(operationKey).result, {});
  }
});

test('completed duplicate returns the recorded safe result without a provider call', async () => {
  const ledger = attemptLedger();
  const operationKey = shipStationOperationKey({
    operation: 'label_void', orderId: ORDER_ID, orderShipmentId: SPLIT_A,
    discriminator: 'se-label-a',
  });
  ledger.rows.set(operationKey, { status: 'completed', result: { label_id: 'se-label-a', approved: true } });
  let providerCalls = 0;

  const result = await runShipStationProviderOperation({
    operationKey,
    leaseOwner: 'worker-b',
    attemptAdapter: ledger,
    callProvider: async () => { providerCalls += 1; },
    summarizeProviderResult: () => ({}),
    finalize: async () => assert.fail('completed replay must not finalize twice'),
  });

  assert.equal(result.replayed, true);
  assert.deepEqual(result.result, { label_id: 'se-label-a', approved: true });
  assert.equal(providerCalls, 0);
});

test('ambiguous provider failure stays reconcilable while proven non-acceptance releases', async () => {
  for (const [classification, expected] of [['ambiguous', 'reconcile_required'], ['not_accepted', 'released']]) {
    const ledger = attemptLedger();
    const operationKey = shipStationOperationKey({
      operation: 'shipment_cancel', orderId: ORDER_ID, orderShipmentId: SPLIT_A,
      revision: 4, discriminator: classification,
    });
    const providerError = Object.assign(new Error(classification), { code: `provider_${classification}` });

    await assert.rejects(
      runShipStationProviderOperation({
        operationKey,
        leaseOwner: 'worker-c',
        attemptAdapter: ledger,
        callProvider: async () => { throw providerError; },
        summarizeProviderResult: () => ({}),
        finalize: async () => assert.fail('failed provider call cannot finalize'),
        classifyProviderError: () => classification,
      }),
      providerError,
    );
    assert.equal(ledger.rows.get(operationKey).status, expected);
  }
});

test('an expired lease is reconciliation-only and never crosses the provider seam', async () => {
  let providerCalls = 0;
  const operationKey = shipStationOperationKey({
    operation: 'label_return', orderId: ORDER_ID, orderShipmentId: SPLIT_A,
    discriminator: 'se-label-a',
  });
  await assert.rejects(
    runShipStationProviderOperation({
      operationKey,
      leaseOwner: 'worker-takeover',
      attemptAdapter: {
        claim: async () => ({ state: 'reconcile_required', error_code: 'lease_expired' }),
        providerSucceeded: async () => assert.fail('expired attempt cannot record provider success'),
        complete: async () => assert.fail('expired attempt cannot complete'),
        reconcile: async () => assert.fail('expired attempt is already reconcilable'),
        release: async () => assert.fail('expired attempt cannot release without evidence'),
      },
      callProvider: async () => { providerCalls += 1; },
      finalize: async () => assert.fail('expired attempt cannot finalize'),
    }),
    (error) => error instanceof ShipStationOperationAttemptError
      && error.code === 'shipstation_operation_reconciliation_required',
  );
  assert.equal(providerCalls, 0);
});

test('attempt request fingerprints are stable across object-key ordering', async () => {
  const first = await shipStationRequestFingerprint({
    packages: [{ weight: 10, unit: 'pound' }], split: 'drums', revision: 2,
  });
  const second = await shipStationRequestFingerprint({
    revision: 2, split: 'drums', packages: [{ unit: 'pound', weight: 10 }],
  });
  const changed = await shipStationRequestFingerprint({
    revision: 3, split: 'drums', packages: [{ unit: 'pound', weight: 10 }],
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('ownership migration backfills canonical splits and fences every provider mutation', async () => {
  const sql = await readFile(new URL('../supabase/schema-shipment-label-ownership.sql', import.meta.url), 'utf8');

  assert.match(sql, /^\s*(?:--[^\n]*\n)*\s*begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /alter table public\.orders\s+add column if not exists updated_at timestamptz not null default now\(\);[\s\S]+insert into public\.order_shipments/i);
  assert.match(sql, /create(?: or replace)? view public\.order_shipment_label_ownership/i);
  assert.match(sql, /insert into public\.order_shipments[\s\S]+shipstation_label_id/is);
  assert.match(sql, /perform public\.link_order_provider_object[\s\S]+order_shipment_id/is);
  assert.match(sql, /prevent_shipstation_label_relation_change[\s\S]+shipstation_label_relation_immutable/i);
  assert.match(sql, /existing_label\.metadata->>'order_shipment_id'[\s\S]+shipment\.id::text = existing_label\.metadata->>'order_shipment_id'/i);
  assert.match(sql, /create table if not exists public\.shipstation_operation_attempts/i);
  assert.match(sql, /lease_expires_at\s+timestamptz not null/i);
  assert.match(sql, /provider_succeeded_at\s+timestamptz/i);
  assert.match(sql, /jsonb_typeof\(p_value\) = 'string'[\s\S]+https\?:\/\//i);
  assert.match(sql, /status = 'reconcile_required'[\s\S]+shipstation_operation_lease_expired/is);
  assert.match(sql, /attempt\.operation in \('shipment_create','shipment_update','shipment_cancel'\)[\s\S]+update public\.order_shipments[\s\S]+operation_state = 'reconcile_required'/i);
  assert.match(sql, /p_nonacceptance_evidence[\s\S]+provider_not_found[\s\S]+provider_rejected/is);
  assert.match(sql, /prevent_shipstation_operation_attempt_identity_change/i);
  assert.match(sql, /revoke all on public\.shipstation_operation_attempts from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_shipstation_operation_attempt[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[^;]+to (?:anon|authenticated)/i);
  for (const operation of [
    'shipment_create', 'shipment_update', 'shipment_cancel',
    'label_purchase', 'label_void', 'label_return',
  ]) assert.match(sql, new RegExp(`'${operation}'`));
});

test('durable mutation claims give replacement shipments and labels new incarnations', async () => {
  const sql = await readFile(new URL('../supabase/schema-shipment-label-ownership.sql', import.meta.url), 'utf8');
  const shipmentStart = sql.indexOf('create or replace function public.claim_order_shipment_operation_attempt');
  const labelStart = sql.indexOf('create or replace function public.claim_order_shipment_label_purchase_attempt');
  const shipmentClaim = sql.slice(shipmentStart, labelStart);
  const labelEnd = sql.indexOf('create or replace function public.claim_shipstation_label_void_attempt', labelStart);
  const labelClaim = sql.slice(labelStart, labelEnd);

  assert.match(shipmentClaim, /p_operation = 'create'[\s\S]+max\(generation\)[\s\S]+':generation:'\s*\|\|\s*v_generation/i);
  assert.match(shipmentClaim, /claim_shipstation_operation_attempt\([\s\S]+v_operation_key/i);
  assert.match(shipmentClaim, /jsonb_build_object\([\s\S]+operation_key'[\s\S]+v_operation_key/i);
  assert.match(labelClaim, /count\(\*\)[\s\S]+object_type = 'label'[\s\S]+':purchase:'\s*\|\|\s*v_purchase_generation/i);
  assert.match(labelClaim, /claim_shipstation_operation_attempt\([\s\S]+v_operation_key/i);
  assert.match(labelClaim, /jsonb_build_object\([\s\S]+operation_key'[\s\S]+v_operation_key/i);
});

test('tracking projection resolves exact labels and requires every active split to finish', async () => {
  const sql = await readFile(new URL('../supabase/schema-provider-inbox.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('create or replace function public.apply_shipstation_tracking_integration_effect');
  const end = sql.indexOf('create or replace function public.apply_resend_delivery_integration_effect', start);
  const tracking = sql.slice(start, end);

  assert.match(tracking, /from public\.order_shipment_label_ownership ownership/i);
  assert.match(tracking, /order_shipment_id, provider_label_id/i);
  assert.match(tracking, /update public\.order_provider_links[\s\S]+tracking_occurred_at/i);
  assert.match(tracking, /from public\.order_shipments required[\s\S]+required\.status <> 'cancelled'/i);
  assert.match(tracking, /v_any_label and v_all_terminal/i);
  assert.match(tracking, /v_label\.label_kind = 'return'[\s\S]+return public\.finish_integration_projection/i);
  assert.doesNotMatch(tracking, /from public\.orders\s+where tracking_number/i);
  assert.doesNotMatch(tracking, /where shipstation_return_tracking_number/i);
});

test('runtime mutations use atomic attempt claims and expose read-only reconciliation hooks', async () => {
  const source = await readFile(new URL('../functions/_lib/shipstation-orders.js', import.meta.url), 'utf8');
  for (const rpc of [
    'claim_order_shipment_operation_attempt',
    'claim_order_shipment_label_purchase_attempt',
    'claim_shipstation_label_void_attempt',
    'claim_shipstation_return_label_attempt',
    'mark_shipstation_operation_provider_succeeded',
    'complete_shipstation_operation_attempt',
    'claim_shipstation_operation_reconciliation',
    'release_shipstation_operation_attempt',
  ]) assert.match(source, new RegExp(`['"]${rpc}['"]`));
  assert.match(source, /export async function reconcileOrderShipment/);
  assert.match(source, /export async function reconcileOrderLabelPurchase/);
  assert.match(source, /export async function reconcileOrderLabelVoid/);
  assert.match(source, /export async function reconcileOrderReturnLabel/);
  assert.match(source, /providerFailureIsProvenRejection/);
});

test('admin operations expose exact void and return reconciliation without guessing labels', async () => {
  const api = await readFile(new URL('../functions/api/admin/shipstation.js', import.meta.url), 'utf8');
  const ordersApi = await readFile(new URL('../functions/api/admin/orders.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../js/admin/orders.js', import.meta.url), 'utf8');

  assert.match(api, /reconcile_label_void[\s\S]+reconcileLabelVoid/);
  assert.match(api, /reconcile_return_label[\s\S]+reconcileReturnLabel/);
  assert.ok((ordersApi.match(/shipstation_operation_attempts\(/g) || []).length >= 2);
  assert.match(ordersApi, /order_provider_links\(id,provider,object_type,provider_object_id/);
  assert.match(ui, /data-shipstation-reconcile-void/);
  assert.match(ui, /data-shipstation-reconcile-return/);
  assert.match(ui, /No provider action was guessed/);
  assert.match(ui, /action:\s*kind === 'void' \? 'reconcile_label_void' : 'reconcile_return_label'/);
});
