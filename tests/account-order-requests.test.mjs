import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountOrderRequestsHandler } from '../functions/api/account/order-requests.js';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const TICKET_ID = '44444444-4444-4444-8444-444444444444';

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

function handlerFor(sb, overrides = {}) {
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
    ...overrides,
  });
}

function postRequest() {
  return new Request('https://masest.test/api/account/order-requests', { method: 'POST' });
}

test('buyer order request and linked support message use one atomic RPC', async () => {
  let deliveredMessage = null;
  const sb = requestClient({
    data: {
      duplicate: false,
      request: { id: '55555555-5555-4555-8555-555555555555', order_id: ORDER_ID, type: 'cancel', status: 'open' },
      message: {
        id: '66666666-6666-4666-8666-666666666666',
        order_id: ORDER_ID,
        ticket_id: TICKET_ID,
        ticket: {
          id: TICKET_ID,
          ticket_number: 42,
          thread_id: '77777777-7777-4777-8777-777777777777',
          subject: 'Cancellation request',
          status: 'open',
          priority: 'normal',
          category: 'order',
          assigned_to: 'staff-private',
          version: 7,
          private_notes: ['never expose'],
        },
      },
      ticket_id: TICKET_ID,
      ticket: {
        id: TICKET_ID,
        ticket_number: 42,
        thread_id: '77777777-7777-4777-8777-777777777777',
        subject: 'Cancellation request',
        status: 'open',
        priority: 'normal',
        category: 'order',
        assigned_to: 'staff-private',
        version: 7,
        private_notes: ['never expose'],
      },
      chat_linked: true,
    },
    error: null,
  });
  const response = await handlerFor(sb, {
    deliverSupportMessageEmail: async (_env, _sb, message) => {
      deliveredMessage = message;
      return { ok: true };
    },
  })({ request: postRequest(), env: {} });

  assert.equal(response.status, 201);
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].name, 'create_order_support_request');
  assert.equal(sb.calls[0].args.p_order_id, ORDER_ID);
  assert.equal(sb.calls[0].args.p_requested_by, USER_ID);
  assert.equal(sb.calls[0].args.p_contract_version, 2);
  assert.match(sb.calls[0].args.p_message_body, /Cancellation requested for order MST-1042/);
  const payload = await response.json();
  assert.equal(payload.request.order_id, ORDER_ID);
  assert.equal(payload.ticket_id, TICKET_ID);
  assert.equal(payload.support_message.ticket_id, TICKET_ID);
  assert.equal(payload.ticket.display_number, 'MAS-000042');
  assert.equal(payload.ticket.assigned_to, undefined);
  assert.equal(payload.ticket.version, undefined);
  assert.equal(payload.ticket.private_notes, undefined);
  assert.equal(payload.support_message.ticket.assigned_to, undefined);
  assert.equal(payload.support_message.ticket.version, undefined);
  assert.equal(payload.support_message.ticket.private_notes, undefined);
  assert.equal(payload.chat_linked, true);
  assert.equal(deliveredMessage.id, '66666666-6666-4666-8666-666666666666');
  assert.deepEqual(payload.email_delivery, { ok: true });
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
      ticket_id: TICKET_ID,
      ticket_mapping_state: 'exact',
    },
    error: null,
  });
  const response = await handlerFor(sb)({ request: postRequest(), env: {} });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.duplicate, true);
  assert.equal(payload.ticket_id, TICKET_ID);
});

test('duplicate request with unproved requester mapping hides nested ticket identity', async () => {
  const sb = requestClient({
    data: {
      duplicate: true,
      request: {
        id: '55555555-5555-4555-8555-555555555555',
        order_id: ORDER_ID,
        ticket_id: TICKET_ID,
        requested_by: 'another-company-user',
        requested_email: 'private@example.test',
        type: 'cancel',
        status: 'open',
      },
      message: null,
      ticket_id: null,
      ticket_mapping_state: 'unknown_legacy',
      ticket: null,
    },
    error: null,
  });

  const response = await handlerFor(sb)({ request: postRequest(), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ticket_id, null);
  assert.equal(payload.ticket, null);
  assert.equal(payload.ticket_mapping_state, 'unknown_legacy');
  assert.equal(payload.request.ticket_id, null);
  assert.equal(payload.request.requested_by, undefined);
  assert.equal(payload.request.requested_email, undefined);
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
