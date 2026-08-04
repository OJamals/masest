import assert from 'node:assert/strict';
import test from 'node:test';

import { createShipStationAdminHandler } from '../functions/api/admin/shipstation.js';

const request = (method = 'GET', body) => new Request('https://masest.co/api/admin/shipstation', {
  method,
  headers: body ? { 'content-type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

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
