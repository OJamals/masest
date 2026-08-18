import assert from 'node:assert/strict';
import test from 'node:test';

import { createShipStationAdminHandler } from '../functions/api/admin/shipstation.js';

const request = (method = 'GET', body) => new Request('https://masest.co/api/admin/shipstation', {
  method,
  headers: body ? { 'content-type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

const queryRequest = (query) => new Request(`https://masest.co/api/admin/shipstation?${query}`);

test('ShipStation admin endpoint is staff-gated and exposes redacted connection status', async () => {
  let statusCalls = 0;
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    status: async () => {
      statusCalls += 1;
      return {
        connected: true,
        config: { api_key: 'present', warehouse_id: 'se-warehouse-1', ready: true },
        carriers: [{ carrier_id: 'se-ups', carrier_code: 'ups', name: 'UPS' }],
        warehouses: [{ warehouse_id: 'se-warehouse-1', name: 'Main' }],
      };
    },
  });

  const response = await handler({ request: request(), env: {} });
  assert.equal(response.status, 200);
  assert.equal(statusCalls, 1);
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(JSON.stringify(body).includes('API-Key'), false);

  const denied = createShipStationAdminHandler({
    requireStaff: async () => ({ user: null, staff: false, role: null }),
    status: async () => assert.fail('provider status must not run before auth'),
  });
  assert.equal((await denied({ request: request(), env: {} })).status, 401);
});

test('ShipStation admin endpoint rejects read-only mutations and dispatches rate, buy, void, and webhook actions', async () => {
  const readOnly = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'read_only' }),
  });
  assert.equal((await readOnly({
    request: request('POST', { action: 'rates', order_id: 'order-1' }),
    env: {},
  })).status, 403);

  const calls = [];
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    rateOrder: async (_env, input) => { calls.push(['rates', input]); return { rates: [] }; },
    buyLabel: async (_env, input) => { calls.push(['label', input]); return { label_id: 'se-label-1' }; },
    voidLabel: async (_env, input) => { calls.push(['void', input]); return { label_id: 'se-label-1', status: 'label_voided' }; },
    configureWebhook: async () => { calls.push(['webhook']); return { configured: true }; },
  });
  assert.equal((await handler({
    request: request('POST', { action: 'rates', order_id: 'order-1' }),
    env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'buy_label', order_id: 'order-1', rate_id: 'se-rate-1' }),
    env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'void_label', order_id: 'order-1', label_id: 'se-label-1', confirm: true, reason: 'Wrong package' }),
    env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'configure_tracking_webhook' }),
    env: {},
  })).status, 200);
  assert.deepEqual(calls.map(([action]) => action), ['rates', 'label', 'void', 'webhook']);
});

test('ShipStation admin endpoint gates label reads, emits no-store, and dispatches lifecycle actions', async () => {
  const calls = [];
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    getLabel: async (_env, input) => { calls.push(['get', input]); return { label_id: input.label_id }; },
    downloadLabel: async (_env, input) => {
      calls.push(['download', input]);
      return new Response('PDF', { headers: { 'content-type': 'application/pdf' } });
    },
    listShipments: async (_env, input) => {
      calls.push(['shipments', input]);
      return { order_id: input.order_id, shipments: [] };
    },
    reconcileLabel: async (_env, input) => { calls.push(['reconcile', input]); return { reconciled: true }; },
    reconcileLabelVoid: async (_env, input) => { calls.push(['reconcile-void', input]); return { reconciled: true }; },
    reconcileReturnLabel: async (_env, input) => { calls.push(['reconcile-return', input]); return { reconciled: true }; },
    returnLabel: async (_env, input) => { calls.push(['return', input]); return { label_id: 'se-return-1' }; },
  });

  const metadata = await handler({ request: queryRequest('action=label&order_id=order-1&label_id=se-label-1'), env: {} });
  assert.equal(metadata.status, 200);
  assert.equal(metadata.headers.get('cache-control'), 'no-store');
  assert.equal((await metadata.json()).label_id, 'se-label-1');

  const document = await handler({ request: queryRequest('action=label_document&order_id=order-1&label_id=se-label-1&format=pdf'), env: {} });
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('cache-control'), 'no-store');
  assert.equal(await document.text(), 'PDF');

  const shipments = await handler({ request: queryRequest('action=shipments&order_id=order-1'), env: {} });
  assert.equal(shipments.status, 200);
  assert.equal(shipments.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await shipments.json()).shipments, []);

  assert.equal((await handler({
    request: request('POST', { action: 'reconcile_label_purchase', order_id: 'order-1', confirm: true, reason: 'Repair timeout' }), env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'return_label', order_id: 'order-1', label_id: 'se-label-1', confirm: true, reason: 'Customer return' }), env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'reconcile_label_void', order_id: 'order-1', label_id: 'se-label-1', confirm: true, reason: 'Repair void timeout' }), env: {},
  })).status, 200);
  assert.equal((await handler({
    request: request('POST', { action: 'reconcile_return_label', order_id: 'order-1', label_id: 'se-label-1', confirm: true, reason: 'Repair return timeout' }), env: {},
  })).status, 200);
  assert.deepEqual(calls.map(([action]) => action), [
    'get', 'download', 'shipments', 'reconcile', 'return', 'reconcile-void', 'reconcile-return',
  ]);

  const readOnly = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'read_only' }),
    getLabel: async () => ({ label_id: 'se-label-1' }),
    reconcileLabel: async () => assert.fail('read-only role must not mutate'),
  });
  const allowedRead = await readOnly({ request: queryRequest('action=label&order_id=order-1&label_id=se-label-1'), env: {} });
  assert.equal(allowedRead.status, 200);
  assert.equal(allowedRead.headers.get('cache-control'), 'no-store');
  assert.equal((await readOnly({
    request: request('POST', { action: 'reconcile_label_purchase', order_id: 'order-1', confirm: true, reason: 'Repair timeout' }), env: {},
  })).status, 403);
});

test('ShipStation reconciliation conflicts preserve 409 instead of becoming provider 502s', async () => {
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    reconcileReturnLabel: async () => {
      throw Object.assign(new Error('multiple exact candidates'), {
        code: 'shipstation_return_reconcile_ambiguous',
      });
    },
  });
  const response = await handler({
    request: request('POST', {
      action: 'reconcile_return_label', order_id: 'order-1', label_id: 'se-label-1',
      confirm: true, reason: 'Resolve ambiguous return',
    }),
    env: {},
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'shipstation_return_reconcile_ambiguous' });
});

test('ShipStation label read auth and errors are no-store', async () => {
  for (const fixture of [
    { auth: { user: null, staff: false, role: null }, status: 401 },
    { auth: { user: { id: 'user-1' }, staff: false, role: null }, status: 403 },
  ]) {
    const handler = createShipStationAdminHandler({ requireStaff: async () => fixture.auth });
    const response = await handler({ request: queryRequest('action=label&order_id=order-1&label_id=se-label-1'), env: {} });
    assert.equal(response.status, fixture.status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    getLabel: async () => { throw Object.assign(new Error('private provider body'), { code: 'shipstation_http_503', status: 503 }); },
  });
  const response = await handler({ request: queryRequest('action=label&order_id=order-1&label_id=se-label-1'), env: {} });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'shipstation_http_503' });
});

test('ShipStation label read converts auth backend failures to no-store errors', async () => {
  const handler = createShipStationAdminHandler({
    requireStaff: async () => {
      throw Object.assign(new Error('private auth backend detail'), { code: 'auth_backend_down', status: 503 });
    },
  });
  const response = await handler({
    request: queryRequest('action=label&order_id=order-1&label_id=se-label-1'),
    env: {},
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'auth_backend_down' });
});

test('ShipStation admin dispatches normalized shipment revision actions and preserves conflicts', async () => {
  const calls = [];
  const handler = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    updateShipment: async (_env, input) => { calls.push(['update', input]); return { revision: 2 }; },
    cancelShipment: async (_env, input) => { calls.push(['cancel', input]); return { status: 'cancelled' }; },
    reconcileShipment: async (_env, input) => { calls.push(['reconcile', input]); return { reconciled: true }; },
    selectShipmentRate: async (_env, input) => { calls.push(['select', input]); return { selected: true }; },
  });
  for (const body of [
    { action: 'update_shipment', order_id: 'order-1' },
    { action: 'cancel_shipment', order_id: 'order-1' },
    { action: 'reconcile_shipment', order_id: 'order-1' },
    { action: 'select_shipment_rate', order_id: 'order-1' },
  ]) assert.equal((await handler({ request: request('POST', body), env: {} })).status, 200);
  assert.deepEqual(calls.map(([action]) => action), ['update', 'cancel', 'reconcile', 'select']);

  const conflict = createShipStationAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true, role: 'owner' }),
    updateShipment: async () => {
      throw Object.assign(new Error('stale revision'), {
        code: 'shipstation_shipment_revision_conflict',
        status: 409,
      });
    },
  });
  const response = await conflict({
    request: request('POST', { action: 'update_shipment', order_id: 'order-1' }),
    env: {},
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'shipstation_shipment_revision_conflict' });
});
