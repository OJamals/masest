import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountOrderRequestsHandler } from '../functions/api/account/order-requests.js';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function requestClient(rpcResult, { companyId = COMPANY_ID } = {}) {
  const calls = [];
  const chain = (result) => ({
    select() { return this; },
    eq() { return this; },
    or() { return this; },
    async maybeSingle() { return result; },
  });
  return {
    calls,
    from(table) {
      if (table === 'profiles') return chain({ data: companyId ? { company_id: companyId } : null, error: null });
      if (table === 'orders') return chain({
        data: {
          id: ORDER_ID,
          order_number: 'MST-1042',
          user_id: USER_ID,
          company_id: companyId,
          status: 'paid',
          tracking_status: null,
          shipped_at: null,
          updated_at: '2026-08-30T12:00:00.000Z',
          customer_email: 'buyer@example.com',
        },
        error: null,
      });
      throw new Error(`unexpected direct table write: ${table}`);
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return rpcResult;
    },
  };
}

function handlerFor(sb) {
  return createAccountOrderRequestsHandler({
    userFromRequest: async () => ({ user: { id: USER_ID, email: 'buyer@example.com' } }),
    adminClient: () => sb,
    rateLimit: async () => ({ ok: true }),
    readBoundedJson: async () => ({
      order_id: ORDER_ID,
      type: 'cancel',
      reason: 'Shipment date no longer works',
      lines: [],
    }),
  });
}

function postRequest() {
  return new Request('https://masest.test/api/account/order-requests', { method: 'POST' });
}

test('buyer order request and linked support message use one atomic RPC', async () => {
  const sb = requestClient({
    data: {
      duplicate: false,
      request: { id: '55555555-5555-4555-8555-555555555555', order_id: ORDER_ID, type: 'cancel', status: 'open' },
      message: { id: '66666666-6666-4666-8666-666666666666', order_id: ORDER_ID },
      chat_linked: true,
    },
    error: null,
  });
  const response = await handlerFor(sb)({ request: postRequest(), env: {} });

  assert.equal(response.status, 201);
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].name, 'create_order_support_request');
  assert.equal(sb.calls[0].args.p_order_id, ORDER_ID);
  assert.equal(sb.calls[0].args.p_requested_by, USER_ID);
  assert.match(sb.calls[0].args.p_message_body, /Cancellation requested for order MST-1042/);
  const payload = await response.json();
  assert.equal(payload.request.order_id, ORDER_ID);
  assert.equal(payload.chat_linked, true);
});

test('buyer order request cannot report success when atomic chat handoff fails', async () => {
  const sb = requestClient({ data: null, error: new Error('atomic handoff failed') });
  const response = await handlerFor(sb)({ request: postRequest(), env: {} });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'server_error' });
});

test('duplicate open buyer order request stays idempotent without another message', async () => {
  const sb = requestClient({
    data: {
      duplicate: true,
      request: { id: '55555555-5555-4555-8555-555555555555', order_id: ORDER_ID, type: 'cancel', status: 'open' },
      message: null,
    },
    error: null,
  });
  const response = await handlerFor(sb)({ request: postRequest(), env: {} });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
});

test('profileless retail buyer keeps atomic cancellation queue without a Company chat', async () => {
  const sb = requestClient({
    data: {
      duplicate: false,
      request: { id: '55555555-5555-4555-8555-555555555555', order_id: ORDER_ID, type: 'cancel', status: 'open' },
      message: null,
      chat_linked: false,
    },
    error: null,
  }, { companyId: null });
  const response = await handlerFor(sb)({ request: postRequest(), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(sb.calls[0].name, 'create_order_support_request');
  assert.equal(payload.support_message, null);
  assert.equal(payload.chat_linked, false);
});
