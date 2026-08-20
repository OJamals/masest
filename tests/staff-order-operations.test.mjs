import assert from 'node:assert/strict';
import test from 'node:test';

import { runStaffOrderOperation } from '../functions/_lib/staff-order-operations.js';

function orderStore(initialOrders) {
  const orders = new Map(initialOrders.map((order) => [order.id, { ...order }]));
  const audits = [];
  const selectOrders = () => ({
    eq(_column, id) {
      return {
        async single() {
          const order = orders.get(id);
          return order
            ? { data: { ...order }, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'not found' } };
        },
      };
    },
    async in(_column, ids) {
      return { data: ids.map((id) => orders.get(id)).filter(Boolean).map((order) => ({ ...order })), error: null };
    },
  });
  const updateOrders = (patch) => ({
    eq(_column, id) {
      return {
        is(_field, expected) {
          return {
            select() {
              return {
                async maybeSingle() {
                  const current = orders.get(id);
                  if (!current || current.accepted_at !== expected) return { data: null, error: null };
                  const updated = { ...current, ...patch };
                  orders.set(id, updated);
                  return { data: { ...updated }, error: null };
                },
              };
            },
          };
        },
      };
    },
    in(_column, ids) {
      return {
        is(_field, expected) {
          return {
            async select() {
              const accepted = [];
              for (const id of ids) {
                const current = orders.get(id);
                if (!current || current.accepted_at !== expected) continue;
                orders.set(id, { ...current, ...patch });
                accepted.push({ id });
              }
              return { data: accepted, error: null };
            },
          };
        },
      };
    },
  });
  return {
    orders,
    audits,
    from(table) {
      if (table === 'orders') {
        return {
          select: selectOrders,
          update: updateOrders,
        };
      }
      if (table === 'audit_log') {
        return {
          async insert(row) {
            audits.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('accept_order is idempotent through the Platform staff Order operations interface', async () => {
  const sb = orderStore([{
    id: 'order-1', order_number: 'MST-1', status: 'paid', accepted_at: null,
    company_id: 'company-1', customer_email: 'buyer@example.com',
  }]);
  const context = {
    body: { action: 'accept_order', id: 'order-1' },
    user: { id: 'staff-1', email: 'staff@example.com' },
    role: 'owner',
    sb,
  };
  const dependencies = { now: () => new Date('2026-08-19T12:00:00.000Z') };

  const accepted = await runStaffOrderOperation(context, dependencies);
  const replay = await runStaffOrderOperation(context, dependencies);

  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.order.accepted_at, '2026-08-19T12:00:00.000Z');
  assert.equal(sb.orders.get('order-1').accepted_by, 'staff-1');
  assert.equal(replay.payload.already_accepted, true);
  assert.equal(sb.audits.length, 1);
  assert.equal(sb.audits[0].action, 'order.accept');
});

test('accept_orders stamps only eligible Orders and reports skipped input', async () => {
  const sb = orderStore([
    { id: 'order-1', status: 'paid', accepted_at: null },
    { id: 'order-2', status: 'cancelled', accepted_at: null },
    { id: 'order-3', status: 'net_open', accepted_at: '2026-08-18T12:00:00.000Z' },
  ]);
  const result = await runStaffOrderOperation({
    body: { action: 'accept_orders', ids: ['order-1', 'order-2', 'order-3', 'order-1'] },
    user: { id: 'staff-1', email: 'staff@example.com' },
    role: 'owner',
    sb,
  }, { now: () => new Date('2026-08-19T12:00:00.000Z') });

  assert.deepEqual(result, {
    status: 200,
    payload: { ok: true, accepted: 1, skipped: 2 },
  });
  assert.equal(sb.orders.get('order-1').accepted_by, 'staff-1');
  assert.equal(sb.orders.get('order-2').accepted_at, null);
  assert.equal(sb.audits[0].action, 'order.accept_bulk');
});

test('cancellation preflight and confirmation expose command outcomes through one interface', async () => {
  const sb = orderStore([]);
  const base = {
    user: { id: 'finance-1', email: 'finance@example.com' },
    role: 'finance',
    sb,
  };
  const command = { id: 'command-1', request_id: 'request-1' };
  const dependencies = {
    prepareCancellationCommand: async () => ({ command, plan: { labels: [] }, replay: false }),
    confirmCancellationCommand: async () => ({ command, replay: false }),
  };

  const preflight = await runStaffOrderOperation({
    ...base,
    body: { action: 'cancel_order', id: 'order-1', reason: 'Buyer requested cancellation' },
  }, dependencies);
  const confirmed = await runStaffOrderOperation({
    ...base,
    body: { action: 'cancel_order', id: 'order-1', command_id: command.id, confirm: true },
  }, dependencies);

  assert.equal(preflight.status, 200);
  assert.equal(preflight.payload.preflight, true);
  assert.equal(confirmed.status, 202);
  assert.equal(confirmed.payload.cancelling, true);
  assert.deepEqual(sb.audits.map((entry) => entry.action), [
    'order.cancel_preflight',
    'order.cancel_queued',
  ]);
});

test('refund queues the immutable command through the Platform staff Order operations interface', async () => {
  const sb = orderStore([]);
  const result = await runStaffOrderOperation({
    body: { action: 'refund', id: 'order-1', amount: 12.34, request_id: 'request-1' },
    user: { id: 'finance-1', email: 'finance@example.com' },
    role: 'finance',
    sb,
  }, {
    queueRefundCommand: async () => ({
      command: { id: 'refund-1', request_id: 'request-1', amount_minor: 1234 },
      replay: false,
    }),
  });

  assert.equal(result.status, 202);
  assert.equal(result.payload.amount, 12.34);
  assert.equal(result.payload.refund_queued, true);
  assert.equal(sb.audits[0].action, 'order.refund_queued');
});

test('create_order validates totals and submits one atomic manual Order write', async () => {
  let rpcCall;
  const audits = [];
  const sb = {
    async rpc(name, args) {
      rpcCall = { name, args };
      return {
        data: {
          id: 'order-1', company_id: 'company-1', status: 'pending_payment', payment_method: 'stripe',
        },
        error: null,
      };
    },
  };
  const result = await runStaffOrderOperation({
    body: {
      action: 'create_order',
      company_id: 'company-1',
      customer_email: 'buyer@example.com',
      status: 'pending_payment',
      payment_method: 'stripe',
      items: [{ sku: 'VK-1', name: 'VertKleen', qty: 2, unit_price: 10 }],
      subtotal: 20,
      shipping: 5,
      tax: 1,
      total: 26,
    },
    user: { id: 'staff-1', email: 'staff@example.com' },
    role: 'owner',
    sb,
  }, {
    recordAudit: async (_sb, entry) => audits.push(entry),
  });

  assert.equal(result.status, 201);
  assert.equal(rpcCall.name, 'create_manual_order_atomic');
  assert.deepEqual(rpcCall.args.p_items, [{
    sku: 'VK-1', product_sku: null, name: 'VertKleen', qty: 2,
    unit_price: 10, line_total: 20, backordered: false,
  }]);
  assert.equal(rpcCall.args.p_order.total, 26);
  assert.equal(audits[0].action, 'order.create');
});

test('create_order rejects inconsistent totals before storage', async () => {
  let stored = false;
  const result = await runStaffOrderOperation({
    body: {
      action: 'create_order',
      status: 'pending_payment',
      payment_method: 'stripe',
      items: [{ sku: 'VK-1', qty: 2, unit_price: 10 }],
      subtotal: 19,
      total: 19,
    },
    user: { id: 'staff-1' },
    role: 'owner',
    sb: { rpc: async () => { stored = true; } },
  });

  assert.deepEqual(result, {
    status: 400,
    payload: { error: 'order_total_mismatch', message: undefined },
  });
  assert.equal(stored, false);
});

test('bare economic status transition is rejected by the Order operations interface', async () => {
  const sb = {
    from(table) {
      assert.equal(table, 'orders');
      return {
        select() {
          return {
            eq(_column, id) {
              assert.equal(id, 'order-1');
              return {
                async single() {
                  return {
                    data: { id, status: 'paid', order_number: 'MST-1' },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const result = await runStaffOrderOperation({
    body: { id: 'order-1', status: 'fulfilled' },
    user: { id: 'staff-1' },
    role: 'owner',
    sb,
  });

  assert.deepEqual(result, {
    status: 409,
    payload: {
      error: 'use_explicit_order_action',
      message: 'Use the dedicated payment, fulfillment, cancellation, or refund action for this transition.',
    },
  });
});

test('record_qbo_invoice rejects non-NET Orders before claiming provider identity', async () => {
  let linked = false;
  const sb = {
    from(table) {
      assert.equal(table, 'orders');
      return {
        select() {
          return {
            eq(_column, id) {
              assert.equal(id, 'order-1');
              return {
                async single() {
                  return {
                    data: { id, order_number: 'MST-1', payment_method: 'stripe' },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const result = await runStaffOrderOperation({
    body: { action: 'record_qbo_invoice', id: 'order-1', qbo_invoice_id: 'inv-1' },
    user: { id: 'finance-1' },
    role: 'finance',
    sb,
    env: {},
    request: new Request('https://masest.test/api/admin/orders'),
  }, {
    linkOrderProviderObject: async () => { linked = true; },
  });

  assert.equal(result.status, 400);
  assert.equal(result.payload.error, 'qbo_invoice_not_net');
  assert.equal(linked, false);
});
