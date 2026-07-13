import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheckoutHandler } from '../functions/api/checkout.js';
import { createStripeWebhookHandler } from '../functions/api/stripe-webhook.js';

const variant = {
  vsku: 'VK-1',
  product_sku: 'VK',
  label: '1 gal',
  price: 25,
  currency: 'usd',
  stripe_price_id: 'price_1',
  active: true,
  stock: 10,
  track_stock: true,
  allow_backorder: false,
  products: { name: 'VertKleen', mode: 'buy', active: true, taxable: true },
};

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

function checkoutDb(calls) {
  return {
    from(table) {
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in() { calls.push('variants.read'); return { data: [variant], error: null }; },
        };
      }
      if (table === 'profiles') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { company_id: 'company-1' }, error: null }; },
        };
      }
      if (table === 'companies') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { id: 'company-1', status: 'approved', net_terms_days: 30, credit_limit: 5000 }, error: null };
          },
        };
      }
      if (table === 'order_items') {
        return {
          async insert(rows) { calls.push(['order_items.insert', rows]); return { error: null }; },
        };
      }
      throw new Error(`unexpected checkout table: ${table}`);
    },
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'place_net_order') return { data: { order_id: 'order-1' }, error: null };
      if (name === 'decrement_variant_stock') return { data: true, error: null };
      throw new Error(`unexpected checkout RPC: ${name}`);
    },
  };
}

test('paid checkout executes Request/env handler and creates Stripe session', async () => {
  const calls = [];
  let sessionParams;
  const handler = createCheckoutHandler({
    adminClient: () => checkoutDb(calls),
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: null }),
    createStripe: () => ({
      checkout: {
        sessions: {
          async create(params) {
            calls.push('stripe.session.create');
            sessionParams = params;
            return { url: 'https://checkout.stripe.test/session' };
          },
        },
      },
    }),
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: 'VK-1', qty: 2 }] }),
    env: { STRIPE_SECRET_KEY: 'sk_test', APP_URL: 'https://masest.test' },
  }));

  assert.deepEqual(result, { status: 200, body: { url: 'https://checkout.stripe.test/session' } });
  assert.equal(sessionParams.line_items[0].quantity, 2);
  assert.deepEqual(calls, ['variants.read', 'stripe.session.create']);
});

test('NET checkout persists header then items then decrements stock', async () => {
  const calls = [];
  const db = checkoutDb(calls);
  const handler = createCheckoutHandler({
    adminClient: () => db,
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } }),
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', { mode: 'net', cart: [{ sku: 'VK-1', qty: 2 }] }),
    env: {},
  }));

  assert.equal(result.status, 201);
  assert.equal(result.body.order_id, 'order-1');
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  assert.ok(labels.indexOf('rpc.place_net_order') < labels.indexOf('order_items.insert'));
  assert.ok(labels.indexOf('order_items.insert') < labels.indexOf('rpc.decrement_variant_stock'));
});

test('checkout rejects empty cart before DB or provider calls', async () => {
  const handler = createCheckoutHandler({
    adminClient: () => { throw new Error('DB must not run'); },
    tierForRequest: async () => { throw new Error('tier lookup must not run'); },
  });
  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', { cart: {} }),
    env: {},
  }));
  assert.deepEqual(result, { status: 400, body: { error: 'cart_empty' } });
});

function paidSession() {
  return {
    id: 'cs_1',
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_subtotal: 2500,
    amount_total: 2500,
    total_details: { amount_tax: 0 },
    currency: 'usd',
    metadata: { cart: JSON.stringify([{ s: 'VK-1', ps: 'VK', q: 1, p: 25 }]) },
    customer_details: { email: 'buyer@example.com' },
  };
}

function webhookDb(calls, persistResults) {
  return {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'persist_stripe_order') return persistResults.shift();
      if (name === 'decrement_variant_stock') return { data: true, error: null };
      throw new Error(`unexpected webhook RPC: ${name}`);
    },
    from(table) {
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in() {
            calls.push('variants.enrich');
            return { data: [{ vsku: 'VK-1', label: '1 gal', products: { name: 'VertKleen' } }], error: null };
          },
        };
      }
      if (table === 'notifications') {
        return {
          async insert(row) { calls.push(['notifications.insert', row]); return { data: null, error: null }; },
        };
      }
      throw new Error(`unexpected webhook table: ${table}`);
    },
  };
}

function webhookRequest() {
  return jsonRequest('https://masest.test/api/stripe-webhook', { event: true }, { 'stripe-signature': 'sig_test' });
}

const webhookEnv = { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' };

test('webhook rejects invalid signature before DB access', async () => {
  const handler = createStripeWebhookHandler({
    constructEvent: async () => { throw new Error('bad signature'); },
    adminClient: () => { throw new Error('DB must not run'); },
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 400, body: { error: 'invalid_signature' } });
});

test('duplicate webhook delivery returns 200 without stock side effects', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ type: 'checkout.session.completed', data: { object: paidSession() } }),
    adminClient: () => webhookDb(calls, [{ data: null, error: { code: '23505' } }]),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true, duplicate: true } });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'rpc.decrement_variant_stock'), false);
});

test('webhook persistence failure retries; stock runs only after durable order', async () => {
  const calls = [];
  const persistResults = [
    { data: null, error: { code: '08006', message: 'connection failure' } },
    { data: { id: 'order-1' }, error: null },
  ];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ type: 'checkout.session.completed', data: { object: paidSession() } }),
    adminClient: () => webhookDb(calls, persistResults),
  });

  const first = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(first, { status: 503, body: { error: 'order_persist_failed' } });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'rpc.decrement_variant_stock'), false);

  const second = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(second.status, 200);
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  const successfulPersist = labels.lastIndexOf('rpc.persist_stripe_order');
  const stock = labels.indexOf('rpc.decrement_variant_stock');
  assert.ok(successfulPersist < stock);
  assert.equal(labels.filter((label) => label === 'rpc.decrement_variant_stock').length, 1);
});

function achDb(calls, claimResults) {
  return {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'decrement_variant_stock') return { data: true, error: null };
      throw new Error(`unexpected ACH RPC: ${name}`);
    },
    from(table) {
      if (table === 'orders') {
        let operation = 'select';
        return {
          select() { return this; },
          update(patch) { operation = 'update'; calls.push(['orders.claim', patch]); return this; },
          eq() { return this; },
          async maybeSingle() {
            if (operation === 'select') {
              return { data: { id: 'order-1', status: 'pending_payment', company_id: null }, error: null };
            }
            return claimResults.shift();
          },
        };
      }
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in() {
            calls.push('variants.enrich');
            return { data: [{ vsku: 'VK-1', label: '1 gal', products: { name: 'VertKleen' } }], error: null };
          },
        };
      }
      throw new Error(`unexpected ACH table: ${table}`);
    },
  };
}

test('concurrent ACH success deliveries have one claim and one stock decrement', async () => {
  const calls = [];
  const db = achDb(calls, [
    { data: { id: 'order-1', status: 'paid', company_id: null }, error: null },
    { data: null, error: null },
  ]);
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ type: 'checkout.session.async_payment_succeeded', data: { object: paidSession() } }),
    adminClient: () => db,
  });

  const first = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  const second = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));

  assert.equal(first.status, 200);
  assert.deepEqual(second, { status: 200, body: { received: true, duplicate: true } });
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  assert.equal(labels.filter((label) => label === 'orders.claim').length, 2);
  assert.equal(labels.filter((label) => label === 'rpc.decrement_variant_stock').length, 1);
});

test('ACH claim failure returns retryable 503 before stock decrement', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ type: 'checkout.session.async_payment_succeeded', data: { object: paidSession() } }),
    adminClient: () => achDb(calls, [{ data: null, error: { message: 'DB unavailable' } }]),
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 503, body: { error: 'order_update_failed' } });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'rpc.decrement_variant_stock'), false);
});

test('subscription status persistence failure returns retryable 503', async () => {
  const failedWrite = { data: null, error: { message: 'DB unavailable' } };
  const query = {
    update() { return this; },
    eq() { return this; },
    then(resolve, reject) { return Promise.resolve(failedWrite).then(resolve, reject); },
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active' } },
    }),
    adminClient: () => ({ from: (table) => {
      assert.equal(table, 'program_subscriptions');
      return query;
    } }),
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 503, body: { error: 'program_subscription_update_failed' } });
});

test('refund queue failure retries before order reconciliation', async () => {
  const calls = [];
  const queueResults = [
    { data: null, error: { message: 'QBO queue unavailable' } },
    { data: null, error: null },
  ];
  const db = {
    from(table) {
      if (table === 'orders') {
        let operation = 'select';
        return {
          select() { return this; },
          update(patch) { operation = 'update'; calls.push(['orders.update', patch]); return this; },
          eq() { return this; },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
          async maybeSingle() {
            assert.equal(operation, 'select');
            return {
              data: { id: 'order-1', company_id: 'company-1', status: 'paid', total: 25, refunded_amount: 0 },
              error: null,
            };
          },
        };
      }
      if (table === 'qbo_refunds') {
        return {
          async upsert(rows) { calls.push(['qbo_refunds.upsert', rows]); return queueResults.shift(); },
        };
      }
      throw new Error(`unexpected refund table: ${table}`);
    },
  };
  const charge = {
    id: 'ch_1',
    payment_intent: 'pi_1',
    amount_refunded: 2500,
    refunds: { data: [{ id: 're_1', amount: 2500, status: 'succeeded' }] },
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ type: 'charge.refunded', data: { object: charge } }),
    adminClient: () => db,
  });

  const first = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(first, { status: 503, body: { error: 'qbo_refund_queue_failed' } });
  assert.equal(calls.some((call) => call[0] === 'orders.update'), false);

  const second = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(second.status, 200);
  const labels = calls.map((call) => call[0]);
  assert.equal(labels.filter((label) => label === 'qbo_refunds.upsert').length, 2);
  assert.equal(labels.filter((label) => label === 'orders.update').length, 1);
  assert.ok(labels.lastIndexOf('qbo_refunds.upsert') < labels.indexOf('orders.update'));
});
