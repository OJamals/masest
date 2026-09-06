import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverOrderEmailEffect } from '../functions/_lib/order-email-effects.js';

function db(order) {
  return {
    from(table) {
      assert.equal(table, 'orders');
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }) };
    },
  };
}

function companyDb(order, profiles, users) {
  return {
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: users[id] } }, error: null }) } },
    from(table) {
      if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }) };
      if (table === 'profiles') return { select: () => ({ eq: async () => ({ data: profiles, error: null }) }) };
      throw new Error(`unexpected ${table}`);
    },
  };
}

function eventDb(order, metadata) {
  return {
    from(table) {
      if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }) };
      if (table === 'integration_events') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata }, error: null }) }) }) };
      throw new Error(`unexpected ${table}`);
    },
  };
}

test('tracking effect sends canonical order mail with operation idempotency', async () => {
  const calls = [];
  const result = await deliverOrderEmailEffect({
    env: { APP_URL: 'https://masest.co' },
    sb: db({ id: 'order-1', order_number: 'MST-1', customer_email: 'Buyer@Example.com', tracking_status: 'shipped', tracking_number: '1Z', carrier: 'UPS' }),
    effect: { provider: 'masest', effect_type: 'order_tracking_email', payload: { order_id: 'order-1', operation_id: 'op-1' }, metadata: {
      order_number: 'MST-1', customer_email: 'buyer@example.com', company_id: null,
      tracking_status: 'shipped', carrier: 'UPS', tracking_number: '1Z', tracking_url: null,
      estimated_delivery_at: null, shipped_at: null,
    } },
  }, { sendEmail: async (_env, options) => { calls.push(options); return { ok: true, providerMessageId: 'provider-1' }; } });
  assert.equal(result.ok, true);
  assert.equal(calls[0].category, 'order');
  assert.equal(calls[0].idempotencyKey, 'order-tracking:op-1');
});

test('return label effect refuses an identity mismatch before sending', async () => {
  let sends = 0;
  await assert.rejects(
    () => deliverOrderEmailEffect({
      env: {},
      sb: db({ id: 'order-1', customer_email: 'buyer@example.com', shipstation_return_label_id: 'se-real' }),
      effect: { provider: 'masest', effect_type: 'return_label_email', payload: { order_id: 'order-1', return_id: 'se-other' } },
    }, { sendEmail: async () => { sends += 1; return { ok: true }; } }),
    /return_label_email_identity_mismatch/,
  );
  assert.equal(sends, 0);
});

test('return label effect preserves the durable printable label URL', async () => {
  const calls = [];
  const result = await deliverOrderEmailEffect({
    env: { APP_URL: 'https://masest.co', ORDER_NOTIFY_EMAIL: 'ops@masest.co' },
    sb: db({ id: 'order-1', order_number: 'MST-1', customer_email: 'buyer@example.com', shipstation_return_label_id: 'se-real' }),
    effect: {
      provider: 'masest', effect_type: 'return_label_email',
      payload: { order_id: 'order-1', return_id: 'se-real' },
      metadata: { label_url: 'https://labels.example/return.pdf', tracking_number: 'RET-1', customer_email: 'buyer@example.com',
        order_number: 'MST-ORIGINAL', carrier: 'UPS', reason: 'Customer requested return' },
    },
  }, { sendEmail: async (_env, options) => { calls.push(options); return { ok: true, providerMessageId: 'provider-2' }; } });
  assert.equal(result.ok, true);
  assert.match(calls[0].html, /labels\.example\/return\.pdf/);
  assert.deepEqual(calls[0].bcc, ['ops@masest.co']);
  assert.match(calls[0].html, /Reason on file: Customer requested return/);
});

test('tracking snapshot preserves null fields and keeps mandatory company recipients', async () => {
  const calls = [];
  await deliverOrderEmailEffect({
    env: { APP_URL: 'https://masest.co' },
    sb: companyDb({ id: 'order-1', order_number: 'MST-1', customer_email: 'buyer@example.com', tracking_status: 'shipped', tracking_number: 'NEW', tracking_url: 'https://new.example', carrier: 'NEW' }, [
      { id: 'profile-1', notify_orders: false }, { id: 'profile-2', notify_orders: true },
    ], { 'profile-1': 'opted@example.com', 'profile-2': 'company@example.com' }),
    effect: { provider: 'masest', effect_type: 'order_tracking_email', payload: { order_id: 'order-1', operation_id: 'op-2' }, metadata: {
      order_number: 'MST-1', customer_email: 'buyer@example.com', company_id: 'company-1',
      tracking_status: 'shipped', carrier: 'UPS', tracking_number: 'OLD', tracking_url: null,
      estimated_delivery_at: null, shipped_at: null,
    } },
  }, { sendEmail: async (_env, options) => { calls.push(options); return { ok: true }; } });
  assert.deepEqual(calls[0].to, ['buyer@example.com', 'opted@example.com', 'company@example.com']);
  assert.doesNotMatch(calls[0].html, /new\.example/);
  assert.match(calls[0].html, /OLD/);
});

test('tracking effect fails closed on company auth outage before provider send', async () => {
  let sends = 0;
  const sb = {
    auth: { admin: { getUserById: async () => ({ data: null, error: new Error('auth unavailable') }) } },
    from(table) {
      if (table === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'order-1' }, error: null }) }) }) };
      if (table === 'profiles') return { select: () => ({ eq: async () => ({ data: [{ id: 'profile-1', notify_orders: true }], error: null }) }) };
      throw new Error(`unexpected ${table}`);
    },
  };
  await assert.rejects(() => deliverOrderEmailEffect({
    env: {}, sb,
    effect: { provider: 'masest', effect_type: 'order_tracking_email',
      payload: { order_id: 'order-1', operation_id: 'op-auth' },
      metadata: { order_number: 'MST-1', customer_email: 'buyer@example.com', company_id: 'company-1', tracking_status: 'shipped' } },
  }, { sendEmail: async () => { sends += 1; return { ok: true }; } }), /auth unavailable/);
  assert.equal(sends, 0);
});

test('central dispatch effect shape hydrates immutable snapshot by event id', async () => {
  const calls = [];
  await deliverOrderEmailEffect({
    env: { APP_URL: 'https://masest.co' },
    sb: eventDb({ id: 'order-1', order_number: 'MST-1', customer_email: 'new@example.com' }, {
      order_number: 'MST-OLD', customer_email: 'old@example.com', company_id: null,
      tracking_status: 'shipped', carrier: 'UPS', tracking_number: 'OLD-TRACK',
      tracking_url: null, estimated_delivery_at: null, shipped_at: null,
    }),
    effect: { id: 'effect-1', event_id: 'event-1', provider: 'masest', effect_type: 'order_tracking_email',
      payload: { order_id: 'order-1', operation_id: 'op-central' } },
  }, { sendEmail: async (_env, options) => { calls.push(options); return { ok: true }; } });
  assert.deepEqual(calls[0].to, ['old@example.com']);
  assert.match(calls[0].html, /OLD-TRACK/);
  assert.match(calls[0].html, /MST-OLD/);
});
