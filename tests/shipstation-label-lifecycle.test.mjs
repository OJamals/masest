import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOrderReturnLabel,
  downloadOrderLabel,
  getOrderLabel,
  reconcileOrderLabelPurchase,
  reconcileOrderLabelVoid,
  reconcileOrderReturnLabel,
} from '../functions/_lib/shipstation-orders.js';

const ORDER_ID = '70f81af0-5ae5-4ea7-953b-f612b6e0ed91';
const ORDER_SHIPMENT_ID = '11111111-1111-4111-8111-111111111111';
const baseOrder = {
  id: ORDER_ID,
  order_number: 'MST-00000123',
  status: 'paid',
  currency: 'usd',
  ship_address: { address: { country: 'US' } },
  shipstation_shipment_id: 'se-shipment-1',
  shipstation_order_shipment_id: ORDER_SHIPMENT_ID,
  shipstation_rate_id: 'se-rate-1',
  shipstation_label_id: 'se-label-1',
  shipstation_label_status: 'label_purchased',
  shipstation_cost: 12.34,
  shipstation_updated_at: '2026-08-04T17:00:00.000Z',
  tracking_status: 'packing',
  order_shipments: [{
    id: ORDER_SHIPMENT_ID,
    split_key: 'default',
    revision: 1,
    provider_shipment_id: 'se-shipment-1',
    selected_rate_id: 'se-rate-1',
    status: 'rated',
  }],
  order_provider_links: [{
    id: 'outbound-link-1',
    provider: 'shipstation',
    object_type: 'label',
    provider_object_id: 'se-label-1',
    metadata: {
      order_shipment_id: ORDER_SHIPMENT_ID,
      shipment_id: 'se-shipment-1',
      revision: 1,
      status: 'label_purchased',
      tracking_status: 'packing',
      cost: 12.34,
      currency: 'usd',
    },
  }],
  order_financial_entries: [{
    source: 'shipstation',
    entry_type: 'postage_purchase',
    provider_object_id: 'se-label-1',
    amount: 12.34,
    currency: 'usd',
    recognition_state: 'recognized',
  }],
};

const providerLabel = {
  label_id: 'se-label-1',
  shipment_id: 'se-shipment-1',
  status: 'completed',
  is_return_label: false,
  voided: false,
  tracking_number: '1Z999AA10123456784',
  carrier_code: 'ups',
  service_code: 'ups_ground',
  label_format: 'pdf',
  shipment_cost: { currency: 'usd', amount: 12.34 },
  label_download: {
    pdf: 'https://api.shipengine.com/v1/downloads/1/token/label.pdf',
    png: 'https://api.shipengine.com/v1/downloads/1/token/label.png',
    zpl: 'https://api.shipengine.com/v1/downloads/1/token/label.zpl',
  },
};

function pendingPurchaseOrder(overrides = {}) {
  return {
    ...baseOrder,
    shipstation_label_id: null,
    shipstation_label_status: 'reconcile_required',
    order_provider_links: [],
    order_financial_entries: [],
    ...overrides,
  };
}

test('getOrderLabel requires exact order label and returns no provider URL', async () => {
  const result = await getOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1' },
    {},
    { loadOrder: async () => baseOrder, getLabel: async () => providerLabel },
  );
  assert.deepEqual(result.available_formats, ['pdf', 'png', 'zpl']);
  assert.equal(result.label_id, 'se-label-1');
  assert.equal(result.cost, 12.34);
  assert.doesNotMatch(JSON.stringify(result), /downloads|label_download|token/);

  await assert.rejects(
    getOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: ORDER_ID, label_id: 'se-label-other' },
      {},
      { loadOrder: async () => baseOrder, getLabel: async () => assert.fail('mismatch must precede provider') },
    ),
    (error) => error.code === 'shipstation_label_order_mismatch',
  );
});

test('getOrderLabel authorizes a return label linked through the order provider ledger', async () => {
  const returnLabel = {
    ...providerLabel,
    label_id: 'se-return-linked-1',
    is_return_label: true,
    outbound_label_id: 'se-label-1',
    shipment_cost: { currency: 'usd', amount: 9.87 },
  };
  const order = {
    ...baseOrder,
    shipstation_return_label_id: null,
    order_provider_links: [...baseOrder.order_provider_links, {
      provider: 'shipstation',
      object_type: 'return_label',
      provider_object_id: 'se-return-linked-1',
      metadata: { outbound_label_id: 'se-label-1', order_shipment_id: ORDER_SHIPMENT_ID },
    }],
  };
  const result = await getOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-return-linked-1' },
    {},
    { loadOrder: async () => order, getLabel: async () => returnLabel },
  );
  assert.equal(result.label_id, 'se-return-linked-1');
  assert.equal(result.is_return_label, true);
  assert.doesNotMatch(JSON.stringify(result), /downloads|label_download|token/);
});

test('getOrderLabel authorizes an outbound split label linked through the order provider ledger', async () => {
  const linkedLabel = { ...providerLabel, label_id: 'se-label-split-a', shipment_id: 'se-shipment-split-a' };
  const order = {
    ...baseOrder,
    order_shipments: [...baseOrder.order_shipments, {
      id: '22222222-2222-4222-8222-222222222222',
      split_key: 'split_a',
      revision: 0,
      provider_shipment_id: 'se-shipment-split-a',
      status: 'rated',
    }],
    order_provider_links: [...baseOrder.order_provider_links, {
      provider: 'shipstation',
      object_type: 'label',
      provider_object_id: 'se-label-split-a',
      metadata: {
        order_shipment_id: '22222222-2222-4222-8222-222222222222',
        shipment_id: 'se-shipment-split-a',
        status: 'label_purchased',
        tracking_status: 'packing',
      },
    }],
  };
  const result = await getOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-split-a' },
    {},
    { loadOrder: async () => order, getLabel: async () => linkedLabel },
  );
  assert.equal(result.label_id, 'se-label-split-a');
  assert.equal(result.is_return_label, false);
});

test('downloadOrderLabel proxies allowlisted bytes with no-store and no provider URL', async () => {
  let fetched;
  let providerReads = 0;
  const response = await downloadOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', format: 'pdf' },
    {},
    {
      loadOrder: async () => baseOrder,
      getLabel: async () => { providerReads += 1; return providerLabel; },
      fetchDocument: async (url, options) => {
        fetched = { url, options };
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: { 'content-type': 'application/pdf', 'content-length': '4' },
        });
      },
    },
  );
  assert.equal(fetched.url, providerLabel.label_download.pdf);
  assert.equal(fetched.options.redirect, 'manual');
  assert.equal(providerReads, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /MST-00000123-label-se-label-1\.pdf/);
  assert.equal((await response.arrayBuffer()).byteLength, 4);
});

test('downloadOrderLabel rejects SSRF, media mismatch, and oversized documents', async () => {
  for (const fixture of [
    {
      label: { ...providerLabel, label_download: { pdf: 'https://example.com/private.pdf' } },
      fetchDocument: async () => assert.fail('bad host must fail before fetch'),
      code: 'shipstation_label_document_url_invalid',
    },
    {
      label: providerLabel,
      fetchDocument: async () => new Response('html', { headers: { 'content-type': 'text/html', 'content-length': '4' } }),
      code: 'shipstation_label_document_type_invalid',
    },
    {
      label: providerLabel,
      fetchDocument: async () => new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': String(10 * 1024 * 1024 + 1) } }),
      code: 'shipstation_label_document_too_large',
    },
  ]) {
    await assert.rejects(
      downloadOrderLabel(
        { SHIPSTATION_API_KEY: 'secret' },
        { order_id: ORDER_ID, label_id: 'se-label-1', format: 'pdf' },
        {},
        { loadOrder: async () => baseOrder, getLabel: async () => fixture.label, fetchDocument: fixture.fetchDocument },
      ),
      (error) => error.code === fixture.code,
    );
  }
});

test('downloadOrderLabel cancels a chunked body immediately above 10 MiB', async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(6 * 1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    downloadOrderLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: ORDER_ID, label_id: 'se-label-1', format: 'pdf' },
      {},
      {
        loadOrder: async () => baseOrder,
        getLabel: async () => providerLabel,
        fetchDocument: async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }),
      },
    ),
    (error) => error.code === 'shipstation_label_document_too_large',
  );
  assert.ok(pulls <= 3, `stream pulled ${pulls} chunks before cancellation`);
  assert.equal(cancelled, true);
});

test('downloadOrderLabel times out while the provider document body is stalled', async () => {
  const stalledBody = new ReadableStream({
    pull() { return new Promise(() => {}); },
  });
  const pending = downloadOrderLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', format: 'pdf' },
    {},
    {
      loadOrder: async () => baseOrder,
      getLabel: async () => providerLabel,
      fetchDocument: async () => new Response(stalledBody, {
        headers: { 'content-type': 'application/pdf' },
      }),
      documentTimeoutMs: 10,
    },
  ).then(() => 'resolved', (error) => error.code);
  const outcome = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve('still_pending'), 100)),
  ]);
  assert.equal(outcome, 'shipstation_label_document_timeout');
});

test('reconcileOrderLabelPurchase adopts exactly one exact-shipment label without purchase', async () => {
  const queries = [];
  let finalized;
  const result = await reconcileOrderLabelPurchase(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, confirm: true, reason: 'Repair provider timeout' },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => pendingPurchaseOrder(),
      listLabels: async (_env, query) => {
        queries.push(query);
        return { labels: query.page === 1 ? [providerLabel, { ...providerLabel, label_id: 'se-other', shipment_id: 'se-other-shipment' }] : [], pages: 1 };
      },
      finalizeReconciliation: async (_env, input) => { finalized = input; return { applied: true }; },
      audit: async () => assert.fail('successful adoption audits inside atomic finalizer'),
      purchaseLabel: async () => assert.fail('reconciliation must never purchase'),
      now: () => new Date('2026-08-04T18:00:00.000Z'),
    },
  );
  assert.equal(result.reconciled, true);
  assert.equal(result.label_id, 'se-label-1');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].page_size, 100);
  assert.equal(queries[0].created_at_start, '2026-08-04T16:45:00.000Z');
  assert.equal(finalized.orderId, ORDER_ID);
  assert.equal(finalized.shipmentId, 'se-shipment-1');
  assert.equal(finalized.labelId, 'se-label-1');
  assert.equal(finalized.cost, 12.34);
  assert.equal(finalized.currency, 'usd');
  assert.equal(finalized.labelStatus, 'label_purchased');
});

test('reconcileOrderLabelPurchase remains retryable when atomic finalization fails', async () => {
  let attempts = 0;
  const dependencies = {
    loadOrder: async () => pendingPurchaseOrder(),
    listLabels: async () => ({ labels: [providerLabel], pages: 1 }),
    finalizeReconciliation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transaction_failed');
      return { applied: true };
    },
    purchaseLabel: async () => assert.fail('reconciliation must never purchase'),
    now: () => new Date('2026-08-04T18:00:00.000Z'),
  };
  const input = { order_id: ORDER_ID, confirm: true, reason: 'Repair provider timeout' };
  await assert.rejects(reconcileOrderLabelPurchase({ SHIPSTATION_API_KEY: 'secret' }, input, {}, dependencies), /transaction_failed/);
  const result = await reconcileOrderLabelPurchase({ SHIPSTATION_API_KEY: 'secret' }, input, {}, dependencies);
  assert.equal(result.reconciled, true);
  assert.equal(attempts, 2);
});

test('reconcileOrderLabelPurchase closes a provider-success attempt after canonical finalization', async () => {
  let completed;
  const result = await reconcileOrderLabelPurchase(
    { SHIPSTATION_API_KEY: 'secret' },
    {
      order_id: ORDER_ID,
      order_shipment_id: ORDER_SHIPMENT_ID,
      confirm: true,
      reason: 'Close the durable attempt after local finalization',
    },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({
        ...baseOrder,
        shipstation_operation_attempts: [{
          operation_key: 'label_purchase:completed-locally',
          operation: 'label_purchase',
          order_shipment_id: ORDER_SHIPMENT_ID,
          provider_object_id: 'se-label-1',
          status: 'provider_succeeded',
          result_summary: { label_id: 'se-label-1', shipment_id: 'se-shipment-1' },
        }],
      }),
      claimAttemptReconciliation: async () => ({
        operation_key: 'label_purchase:completed-locally', lease_owner: 'reconciler-completion',
      }),
      completeOperationAttempt: async (_env, input) => { completed = input; },
      listLabels: async () => assert.fail('canonical completion must not query the provider'),
      finalizeReconciliation: async () => assert.fail('canonical completion must not finalize twice'),
      audit: async () => {},
    },
  );

  assert.equal(result.already_finalized, true);
  assert.equal(result.label_id, 'se-label-1');
  assert.equal(completed.operationKey, 'label_purchase:completed-locally');
  assert.doesNotMatch(JSON.stringify(completed.resultSummary), /https?:\/\//i);
});

test('reconcileOrderLabelPurchase keeps zero/multiple candidates locked', async () => {
  for (const fixture of [
    { labels: [], code: 'shipstation_label_reconcile_not_found' },
    { labels: [providerLabel, { ...providerLabel, label_id: 'se-label-2' }], code: 'shipstation_label_reconcile_ambiguous' },
  ]) {
    let patch;
    await assert.rejects(
      reconcileOrderLabelPurchase(
        { SHIPSTATION_API_KEY: 'secret' },
        { order_id: ORDER_ID, confirm: true, reason: 'Repair provider timeout' },
        { user: { id: 'staff-1' } },
        {
          loadOrder: async () => pendingPurchaseOrder(),
          listLabels: async () => ({ labels: fixture.labels, pages: 1 }),
          persistLabel: async (_env, _id, value) => { patch = value; },
          recordFinancialEntry: async () => assert.fail('unresolved result must not record cost'),
          audit: async () => {},
          now: () => new Date('2026-08-04T18:00:00.000Z'),
        },
      ),
      (error) => error.code === fixture.code,
    );
    assert.equal(patch.shipstation_label_status, 'reconcile_required');
  }
});

test('reconcileOrderLabelPurchase requires confirmation/reason and an uncertain state', async () => {
  for (const fixture of [
    { input: { order_id: ORDER_ID, confirm: false, reason: 'Repair provider timeout' }, code: 'shipstation_label_reconcile_confirmation_required' },
    { input: { order_id: ORDER_ID, confirm: true, reason: 'short' }, code: 'shipstation_label_reconcile_reason_required' },
  ]) {
    await assert.rejects(
      reconcileOrderLabelPurchase({ SHIPSTATION_API_KEY: 'secret' }, fixture.input, {}, {
        loadOrder: async () => assert.fail('input validation must precede DB'),
      }),
      (error) => error.code === fixture.code,
    );
  }
  await assert.rejects(
    reconcileOrderLabelPurchase(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: ORDER_ID, confirm: true, reason: 'Repair provider timeout' },
      {},
      { loadOrder: async () => baseOrder, listLabels: async () => assert.fail('settled state must not query provider') },
    ),
    (error) => error.code === 'shipstation_label_reconcile_not_required',
  );
});

test('createOrderReturnLabel atomically claims, links, and records pending carrier-default cost', async () => {
  const links = [];
  const finance = [];
  let claim;
  let finalized;
  let providerCall;
  const result = await createOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Customer requested return' },
    { user: { id: 'staff-1' }, role: 'owner' },
    {
      loadOrder: async () => baseOrder,
      claimReturn: async (_env, orderId, labelId) => { claim = { orderId, labelId }; return true; },
      createReturn: async (_env, labelId, body) => {
        providerCall = { labelId, body };
        return {
          ...providerLabel,
          label_id: 'se-return-1',
          is_return_label: true,
          outbound_label_id: 'se-label-1',
          charge_event: 'carrier_default',
          shipment_cost: { currency: 'usd', amount: 9.87 },
        };
      },
      finalizeReturn: async (_env, input) => { finalized = input; },
      linkProviderObject: async (_env, link) => links.push(link),
      recordFinancialEntry: async (_env, entry) => finance.push(entry),
      audit: async () => {},
    },
  );
  assert.deepEqual(claim, { orderId: ORDER_ID, labelId: 'se-label-1' });
  assert.deepEqual(providerCall, {
    labelId: 'se-label-1',
    body: { charge_event: 'carrier_default', label_layout: '4x6', label_format: 'pdf', label_download_type: 'url', display_scheme: 'label' },
  });
  assert.equal(finalized.returnLabelId, 'se-return-1');
  assert.equal(result.recognition_state, 'pending');
  assert.equal(links[0].objectType, 'return_label');
  assert.doesNotMatch(JSON.stringify(links[0]), /downloads|token/);
  assert.equal(finance[0].entryType, 'postage_return_label');
  assert.equal(finance[0].state, 'pending');
  assert.equal(finance[0].amount, 9.87);
});

test('createOrderReturnLabel locks an invalid provider response for reconciliation', async () => {
  let patch;
  await assert.rejects(
    createOrderReturnLabel(
      { SHIPSTATION_API_KEY: 'secret' },
      { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Customer requested return' },
      {},
      {
        loadOrder: async () => baseOrder,
        claimReturn: async () => true,
        createReturn: async () => ({ is_return_label: true }),
        persistReturn: async (_env, _id, value) => { patch = value; },
      },
    ),
    (error) => error.code === 'shipstation_return_response_invalid',
  );
  assert.equal(patch.shipstation_return_label_status, 'return_reconcile_required');
});

test('createOrderReturnLabel retry repairs existing result without provider call', async () => {
  const finance = [];
  const audits = [];
  const existing = {
    ...baseOrder,
    shipstation_return_label_id: 'se-return-1',
    shipstation_return_label_status: 'return_label_created',
    shipstation_return_cost: 9.87,
    shipstation_return_charge_event: 'on_creation',
    shipstation_return_tracking_number: '9400111899223856928499',
    order_provider_links: [...baseOrder.order_provider_links, {
      provider: 'shipstation',
      object_type: 'return_label',
      provider_object_id: 'se-return-1',
      metadata: {
        outbound_label_id: 'se-label-1',
        order_shipment_id: ORDER_SHIPMENT_ID,
        status: 'return_label_created',
        tracking_number: '9400111899223856928499',
        cost: 9.87,
        currency: 'usd',
        charge_event: 'on_creation',
      },
    }],
  };
  const result = await createOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Retry return workflow' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => existing,
      claimReturn: async () => assert.fail('existing return must not claim'),
      createReturn: async () => assert.fail('existing return must not call provider'),
      linkProviderObject: async () => {},
      recordFinancialEntry: async (_env, entry) => finance.push(entry),
      audit: async (_env, _context, action, targetId, detail) => audits.push({ action, targetId, detail }),
    },
  );
  assert.equal(result.already_created, true);
  assert.equal(result.label_id, 'se-return-1');
  assert.equal(result.recognition_state, 'recognized');
  assert.equal(finance[0].state, 'recognized');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'shipstation_return_label_repaired');
  assert.equal(audits[0].targetId, ORDER_ID);
  assert.equal(audits[0].detail.return_label_id, 'se-return-1');
});

test('createOrderReturnLabel treats a provider-ledger-only return as existing', async () => {
  const finance = [];
  const audits = [];
  const existing = {
    ...baseOrder,
    shipstation_return_label_id: null,
    shipstation_return_label_status: null,
    order_provider_links: [...baseOrder.order_provider_links, {
      provider: 'shipstation',
      object_type: 'return_label',
      provider_object_id: 'se-return-linked-1',
      metadata: {
        outbound_label_id: 'se-label-1',
        order_shipment_id: ORDER_SHIPMENT_ID,
        status: 'return_label_created',
        tracking_number: '9400111899223856928499',
        cost: 9.87,
        currency: 'usd',
        charge_event: 'on_creation',
      },
    }],
  };
  const result = await createOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Retry linked return workflow' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => existing,
      claimReturn: async () => assert.fail('linked return must not claim'),
      createReturn: async () => assert.fail('linked return must not call provider'),
      linkProviderObject: async () => {},
      recordFinancialEntry: async (_env, entry) => finance.push(entry),
      audit: async (_env, _context, action) => audits.push(action),
    },
  );
  assert.equal(result.already_created, true);
  assert.equal(result.label_id, 'se-return-linked-1');
  assert.equal(result.recognition_state, 'recognized');
  assert.equal(finance[0].providerObjectId, 'se-return-linked-1');
  assert.deepEqual(audits, ['shipstation_return_label_repaired']);
});

test('createOrderReturnLabel ignores an old-outbound return link after replacement', async () => {
  let claims = 0;
  let providerCalls = 0;
  const replacementOrder = {
    ...baseOrder,
    shipstation_label_id: 'se-label-2',
    shipstation_return_label_id: null,
    shipstation_return_label_status: null,
    order_provider_links: [{
      ...baseOrder.order_provider_links[0],
      provider_object_id: 'se-label-2',
      metadata: { ...baseOrder.order_provider_links[0].metadata, status: 'label_purchased' },
    }, {
      ...baseOrder.order_provider_links[0],
      id: 'outbound-link-old',
      provider_object_id: 'se-label-1',
    }, {
      provider: 'shipstation',
      object_type: 'return_label',
      provider_object_id: 'se-return-old',
      metadata: { outbound_label_id: 'se-label-1', order_shipment_id: ORDER_SHIPMENT_ID, status: 'return_label_created' },
    }],
  };
  const result = await createOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-2', confirm: true, reason: 'Return replacement shipment' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => replacementOrder,
      claimReturn: async () => { claims += 1; return true; },
      createReturn: async (_env, labelId) => {
        providerCalls += 1;
        assert.equal(labelId, 'se-label-2');
        return {
          ...providerLabel,
          label_id: 'se-return-new',
          is_return_label: true,
          outbound_label_id: 'se-label-2',
          charge_event: 'carrier_default',
          shipment_cost: { currency: 'usd', amount: 8.76 },
        };
      },
      finalizeReturn: async () => {},
      linkProviderObject: async () => {},
      recordFinancialEntry: async () => {},
      audit: async () => {},
    },
  );
  assert.equal(claims, 1);
  assert.equal(providerCalls, 1);
  assert.equal(result.label_id, 'se-return-new');
});

test('createOrderReturnLabel targets an explicit older split without using the latest projection', async () => {
  const currentShipmentId = '33333333-3333-4333-8333-333333333333';
  const links = [];
  let claimDetail;
  let finalized;
  const splitOrder = {
    ...baseOrder,
    shipstation_order_shipment_id: currentShipmentId,
    shipstation_shipment_id: 'se-shipment-current',
    shipstation_label_id: 'se-label-current',
    order_shipments: [...baseOrder.order_shipments, {
      id: currentShipmentId,
      split_key: 'current',
      revision: 2,
      provider_shipment_id: 'se-shipment-current',
      status: 'rated',
    }],
    order_provider_links: [...baseOrder.order_provider_links, {
      id: 'outbound-link-current',
      provider: 'shipstation',
      object_type: 'label',
      provider_object_id: 'se-label-current',
      metadata: {
        order_shipment_id: currentShipmentId,
        shipment_id: 'se-shipment-current',
        revision: 2,
        status: 'label_purchased',
        tracking_status: 'packing',
      },
    }],
  };

  const result = await createOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Return the older split carton' },
    { user: { id: 'staff-1', email: 'staff@example.com' } },
    {
      loadOrder: async () => splitOrder,
      claimReturn: async (_env, orderId, labelId, detail) => {
        assert.equal(orderId, ORDER_ID);
        assert.equal(labelId, 'se-label-1');
        claimDetail = detail;
        return true;
      },
      createReturn: async (_env, labelId) => ({
        ...providerLabel,
        label_id: 'se-return-old-split',
        is_return_label: true,
        outbound_label_id: labelId,
        charge_event: 'carrier_default',
        shipment_cost: { currency: 'usd', amount: 7.65 },
      }),
      finalizeReturn: async (_env, input) => { finalized = input; },
      linkProviderObject: async (_env, link) => links.push(link),
      recordFinancialEntry: async () => {},
      audit: async () => {},
    },
  );

  assert.equal(claimDetail.orderShipmentId, ORDER_SHIPMENT_ID);
  assert.equal(claimDetail.parentProviderLinkId, 'outbound-link-1');
  assert.equal(finalized.orderShipmentId, ORDER_SHIPMENT_ID);
  assert.equal(links[0].metadata.order_shipment_id, ORDER_SHIPMENT_ID);
  assert.equal(links[0].metadata.outbound_label_id, 'se-label-1');
  assert.equal(result.outbound_label_id, 'se-label-1');
});

test('createOrderReturnLabel validates confirmation, exact label, domestic route, and claim', async () => {
  for (const fixture of [
    { input: { order_id: ORDER_ID, label_id: 'se-label-1', confirm: false, reason: 'Customer requested return' }, code: 'shipstation_return_confirmation_required' },
    { input: { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'short' }, code: 'shipstation_return_reason_required' },
  ]) {
    await assert.rejects(
      createOrderReturnLabel({ SHIPSTATION_API_KEY: 'secret' }, fixture.input, {}, { loadOrder: async () => assert.fail('invalid input') }),
      (error) => error.code === fixture.code,
    );
  }
  for (const fixture of [
    { order: baseOrder, label: 'se-other', code: 'shipstation_label_order_mismatch' },
    { order: { ...baseOrder, ship_address: { address: { country: 'CA' } } }, label: 'se-label-1', code: 'shipstation_return_domestic_required' },
    { order: { ...baseOrder, ship_address: { address: { state: 'MI' } } }, label: 'se-label-1', code: 'shipstation_return_domestic_required' },
    { order: baseOrder, label: 'se-label-1', claim: false, code: 'shipstation_return_locked' },
  ]) {
    await assert.rejects(
      createOrderReturnLabel(
        { SHIPSTATION_API_KEY: 'secret' },
        { order_id: ORDER_ID, label_id: fixture.label, confirm: true, reason: 'Customer requested return' },
        {},
        {
          loadOrder: async () => fixture.order,
          claimReturn: async () => fixture.claim ?? true,
          createReturn: async () => assert.fail('guard must precede provider'),
        },
      ),
      (error) => error.code === fixture.code,
    );
  }
});

test('reconcileOrderLabelVoid reads exact provider state and finalizes without a second void', async () => {
  let finalized;
  let completed;
  const result = await reconcileOrderLabelVoid(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Repair lost void response' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => ({
        ...baseOrder,
        shipstation_label_status: 'void_reconcile_required',
        shipstation_operation_attempts: [{
          operation_key: 'label_void:key',
          operation: 'label_void',
          provider_link_id: 'outbound-link-1',
          status: 'reconcile_required',
        }],
      }),
      claimAttemptReconciliation: async () => ({
        operation_key: 'label_void:key', lease_owner: 'reconciler-a',
      }),
      getLabel: async () => ({ ...providerLabel, voided: true, status: 'voided' }),
      finalizeVoidReconciliation: async (_env, input) => { finalized = input; return { applied: true }; },
      completeOperationAttempt: async (_env, input) => { completed = input; },
      voidLabel: async () => assert.fail('reconciliation must never mutate provider'),
      audit: async () => {},
    },
  );
  assert.equal(finalized.labelId, 'se-label-1');
  assert.equal(completed.operationKey, 'label_void:key');
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'label_voided');
});

test('reconcileOrderReturnLabel adopts one exact parent and keeps zero/multiple candidates locked', async () => {
  const uncertainOrder = {
    ...baseOrder,
    shipstation_return_label_status: 'return_reconcile_required',
    shipstation_return_updated_at: '2026-08-04T17:00:00.000Z',
    shipstation_operation_attempts: [{
      operation_key: 'label_return:key',
      operation: 'label_return',
      parent_provider_link_id: 'outbound-link-1',
      status: 'reconcile_required',
      created_at: '2026-08-04T17:00:00.000Z',
    }],
  };
  const returnLabel = {
    ...providerLabel,
    label_id: 'se-return-reconciled',
    is_return_label: true,
    outbound_label_id: 'se-label-1',
    charge_event: 'carrier_default',
    shipment_cost: { currency: 'usd', amount: 8.25 },
  };
  let finalized;
  let linked;
  let completed;
  const result = await reconcileOrderReturnLabel(
    { SHIPSTATION_API_KEY: 'secret' },
    { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Repair lost return response' },
    { user: { id: 'staff-1' } },
    {
      loadOrder: async () => uncertainOrder,
      claimAttemptReconciliation: async () => ({
        operation_key: 'label_return:key', lease_owner: 'reconciler-b',
      }),
      listLabels: async () => ({ labels: [returnLabel], pages: 1 }),
      finalizeReturnReconciliation: async (_env, input) => { finalized = input; return { applied: true }; },
      linkProviderObject: async (_env, input) => { linked = input; },
      recordFinancialEntry: async () => {},
      audit: async () => {},
      completeOperationAttempt: async (_env, input) => { completed = input; },
      createReturn: async () => assert.fail('reconciliation must never create a return'),
      now: () => new Date('2026-08-04T18:00:00.000Z'),
    },
  );
  assert.equal(finalized.orderShipmentId, ORDER_SHIPMENT_ID);
  assert.equal(linked.metadata.order_shipment_id, ORDER_SHIPMENT_ID);
  assert.equal(completed.operationKey, 'label_return:key');
  assert.equal(result.label_id, 'se-return-reconciled');

  for (const fixture of [
    { labels: [], code: 'shipstation_return_reconcile_not_found' },
    { labels: [returnLabel, { ...returnLabel, label_id: 'se-return-second' }], code: 'shipstation_return_reconcile_ambiguous' },
  ]) {
    let persisted;
    await assert.rejects(
      reconcileOrderReturnLabel(
        { SHIPSTATION_API_KEY: 'secret' },
        { order_id: ORDER_ID, label_id: 'se-label-1', confirm: true, reason: 'Keep ambiguous return locked' },
        {},
        {
          loadOrder: async () => uncertainOrder,
          claimAttemptReconciliation: async () => ({
            operation_key: 'label_return:key', lease_owner: 'reconciler-c',
          }),
          listLabels: async () => ({ labels: fixture.labels, pages: 1 }),
          persistReturn: async (_env, _id, patch) => { persisted = patch; },
          audit: async () => {},
          finalizeReturnReconciliation: async () => assert.fail('ambiguous evidence cannot finalize'),
          now: () => new Date('2026-08-04T18:00:00.000Z'),
        },
      ),
      (error) => error.code === fixture.code,
    );
    assert.equal(persisted.shipstation_return_label_status, 'return_reconcile_required');
    assert.equal(persisted.shipstation_return_error, fixture.code);
  }
});
