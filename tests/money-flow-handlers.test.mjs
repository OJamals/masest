import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheckoutHandler } from '../functions/api/checkout.js';
import { createStripeWebhookHandler } from '../functions/api/stripe-webhook.js';

const encoder = new TextEncoder();

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

function rawRequest(body, headers = {}) {
  return new Request('https://masest.test/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

function checkoutDb(calls, shippingEntries = []) {
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
      if (table === 'content_entries') {
        return {
          select() { return this; },
          eq() { return this; },
          order() {
            calls.push('shipping.read');
            return Promise.resolve({ data: shippingEntries, error: null });
          },
        };
      }
      if (table === 'orders') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { id: 'order-1', order_number: 'MST-00000123' }, error: null };
          },
        };
      }
      throw new Error(`unexpected checkout table: ${table}`);
    },
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'place_net_order_v3') {
        if (args.p_probe) {
          return { data: { duplicate: false, probe: true, rejected: false }, error: null };
        }
        return { data: { order_id: 'order-1', duplicate: false, rejected: false }, error: null };
      }
      throw new Error(`unexpected checkout RPC: ${name}`);
    },
  };
}

function checkoutDbForRequestedSkus(calls) {
  return {
    from(table) {
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in(column, skus) {
            assert.equal(column, 'vsku');
            calls.push('variants.read');
            return {
              data: skus.map((sku) => ({ ...variant, vsku: sku, stock: 2000 })),
              error: null,
            };
          },
        };
      }
      if (table === 'content_entries') {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return Promise.resolve({ data: [], error: null }); },
        };
      }
      throw new Error(`unexpected checkout table: ${table}`);
    },
  };
}

function boundaryCheckoutHandler(calls = []) {
  return createCheckoutHandler({
    adminClient: () => checkoutDbForRequestedSkus(calls),
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: null }),
    createStripe: () => ({
      checkout: {
        sessions: {
          async create() {
            calls.push('stripe.session.create');
            return { url: 'https://checkout.stripe.test/session' };
          },
        },
      },
    }),
  });
}

function checkoutJsonWithByteLength(byteLength) {
  const body = { cart: [{ sku: 'VK-1', qty: 1 }], padding: '' };
  const empty = JSON.stringify(body);
  body.padding = 'x'.repeat(byteLength - encoder.encode(empty).byteLength);
  const source = JSON.stringify(body);
  assert.equal(encoder.encode(source).byteLength, byteLength);
  return source;
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
    request: jsonRequest('https://masest.test/api/checkout', {
      cart: [{ sku: 'VK-1', qty: 2 }],
      purchase_order_number: ' PO-1042 ',
    }),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground,shr_express', APP_URL: 'https://masest.test' },
  }));

  assert.deepEqual(result, { status: 200, body: { url: 'https://checkout.stripe.test/session' } });
  assert.equal(sessionParams.line_items[0].quantity, 2);
  assert.deepEqual(sessionParams.shipping_options, [
    { shipping_rate: 'shr_ground' },
    { shipping_rate: 'shr_express' },
  ]);
  assert.equal(sessionParams.metadata.purchase_order_number, 'PO-1042');
  assert.deepEqual(calls, ['variants.read', 'shipping.read', 'stripe.session.create']);
});

test('published CMS shipping rates override environment fallback', async () => {
  const calls = [];
  let sessionParams;
  const handler = createCheckoutHandler({
    adminClient: () => checkoutDb(calls, [
      { slug: 'express', payload: { stripe_rate_id: 'shr_cmsexpress', active: true, sort_order: 20 } },
      { slug: 'ground', payload: { stripe_rate_id: 'shr_cmsground', active: true, sort_order: 10 } },
    ]),
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: null }),
    createStripe: () => ({
      checkout: { sessions: { async create(params) {
        sessionParams = params;
        return { url: 'https://checkout.stripe.test/session' };
      } } },
    }),
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: 'VK-1', qty: 1 }] }),
    env: {
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_SHIPPING_RATE_IDS: 'shr_env',
      APP_URL: 'https://masest.test',
    },
  }));

  assert.equal(result.status, 200);
  assert.deepEqual(sessionParams.shipping_options, [
    { shipping_rate: 'shr_cmsground' },
    { shipping_rate: 'shr_cmsexpress' },
  ]);
});

test('paid checkout fails closed before Stripe when shipping rates are not configured', async () => {
  const calls = [];
  const handler = createCheckoutHandler({
    adminClient: () => checkoutDb(calls),
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: null }),
    createStripe: () => {
      calls.push('stripe.create');
      throw new Error('Stripe must not run');
    },
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: 'VK-1', qty: 1 }] }),
    env: { STRIPE_SECRET_KEY: 'sk_test', APP_URL: 'https://masest.test' },
  }));

  assert.deepEqual(result, { status: 503, body: { error: 'shipping_not_configured' } });
  assert.deepEqual(calls, ['variants.read', 'shipping.read']);
});

test('NET checkout delegates the complete ledger mutation and PO reference to place_net_order_v3', async () => {
  const calls = [];
  const emails = [];
  const db = checkoutDb(calls);
  const handler = createCheckoutHandler({
    adminClient: () => db,
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } }),
    sendNetOrderConfirmation: async (payload) => { emails.push(payload); },
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', {
      mode: 'net',
      request_key: 'request-1',
      purchase_order_number: ' PO-1042 ',
      cart: [{ sku: 'VK-1', qty: 2 }],
    }),
    env: {},
  }));

  assert.equal(result.status, 201);
  assert.equal(result.body.order_id, 'order-1');
  assert.equal(result.body.order_number, 'MST-00000123');
  assert.equal(result.body.duplicate, false);
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  assert.deepEqual(labels, ['rpc.place_net_order_v3', 'variants.read', 'rpc.place_net_order_v3']);
  const rpcCalls = calls.filter((call) => Array.isArray(call) && call[0] === 'rpc.place_net_order_v3');
  assert.equal(rpcCalls[0][1].p_probe, true);
  assert.equal(rpcCalls[0][1].p_purchase_order_number, 'PO-1042');
  const rpcArgs = rpcCalls[1][1];
  assert.equal(rpcArgs.p_probe, false);
  assert.equal(rpcArgs.p_request_key, 'request-1');
  assert.equal(rpcArgs.p_purchase_order_number, 'PO-1042');
  assert.deepEqual(rpcArgs.p_items, [{
    sku: 'VK-1',
    product_sku: 'VK',
    name: 'VertKleen - 1 gal',
    qty: 2,
    unit_price: 25,
    line_total: 50,
  }]);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].order.order_number, 'MST-00000123');
});

test('response-loss retry returns the original NET order before depleted-stock validation', async () => {
  const calls = [];
  const emails = [];
  const db = checkoutDb(calls);
  const originalFrom = db.from;
  db.from = (table) => {
    if (table === 'product_variants') throw new Error('duplicate retry must not re-read catalog stock');
    return originalFrom(table);
  };
  db.rpc = async (name, args) => {
    calls.push([`rpc.${name}`, args]);
    assert.equal(args.p_probe, true);
    return { data: { order_id: 'order-1', duplicate: true, rejected: false }, error: null };
  };
  const handler = createCheckoutHandler({
    adminClient: () => db,
    tierForRequest: async () => { throw new Error('duplicate retry must not reprice'); },
    userFromRequest: async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } }),
    sendNetOrderConfirmation: async (payload) => { emails.push(payload); },
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', {
      mode: 'net',
      request_key: 'request-1',
      cart: [{ sku: 'VK-1', qty: 2 }],
    }),
    env: {},
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.order_id, 'order-1');
  assert.equal(result.body.order_number, 'MST-00000123');
  assert.equal(result.body.duplicate, true);
  assert.equal(emails.length, 0);
  assert.deepEqual(calls.map((call) => call[0]), ['rpc.place_net_order_v3']);
});

test('duplicate NET response returns the original order without another email', async () => {
  const calls = [];
  const emails = [];
  const db = checkoutDb(calls);
  db.rpc = async (name, args) => {
    calls.push([`rpc.${name}`, args]);
    return { data: { order_id: 'order-1', duplicate: true, rejected: false }, error: null };
  };
  const handler = createCheckoutHandler({
    adminClient: () => db,
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } }),
    sendNetOrderConfirmation: async (payload) => { emails.push(payload); },
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', {
      mode: 'net',
      request_key: 'request-1',
      cart: [{ sku: 'VK-1', qty: 2 }],
    }),
    env: {},
  }));

  assert.deepEqual(result, {
    status: 200,
    body: {
      net: true,
      order_id: 'order-1',
      order_number: 'MST-00000123',
      duplicate: true,
      message: 'Order placed on account. A QuickBooks invoice will follow (NET terms).',
    },
  });
  assert.equal(emails.length, 0);
});

test('missing place_net_order_v3 fails closed with no older RPC call', async () => {
  const calls = [];
  const db = checkoutDb(calls);
  db.rpc = async (name, args) => {
    calls.push([`rpc.${name}`, args]);
    return { data: null, error: { code: 'PGRST202' } };
  };
  const handler = createCheckoutHandler({
    adminClient: () => db,
    tierForRequest: async () => ({ tier: 'retail' }),
    userFromRequest: async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } }),
  });

  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', {
      mode: 'net',
      request_key: 'request-1',
      cart: [{ sku: 'VK-1', qty: 2 }],
    }),
    env: {},
  }));

  assert.deepEqual(result, { status: 503, body: { error: 'net_order_unavailable' } });
  assert.deepEqual(calls.map((call) => Array.isArray(call) ? call[0] : call), [
    'rpc.place_net_order_v3',
  ]);
});

test('checkout rejects invalid purchase-order numbers before DB or provider calls', async () => {
  const handler = createCheckoutHandler({
    adminClient: () => { throw new Error('DB must not run'); },
    createStripe: () => { throw new Error('Stripe must not run'); },
  });

  for (const purchase_order_number of [123, 'P'.repeat(65), 'PO-1\nInjected']) {
    const result = await responseJson(await handler({
      request: jsonRequest('https://masest.test/api/checkout', {
        cart: [{ sku: 'VK-1', qty: 1 }],
        purchase_order_number,
      }),
      env: {},
    }));
    assert.deepEqual(result, {
      status: 400,
      body: { error: 'invalid_purchase_order_number' },
    });
  }
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

test('checkout accepts a JSON body exactly at 64 KiB', async () => {
  const result = await responseJson(await boundaryCheckoutHandler()({
    request: rawRequest(checkoutJsonWithByteLength(64 * 1024), { 'content-length': String(64 * 1024) }),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground', APP_URL: 'https://masest.test' },
  }));

  assert.deepEqual(result, { status: 200, body: { url: 'https://checkout.stripe.test/session' } });
});

test('checkout rejects one byte over 64 KiB before DB access', async () => {
  const handler = createCheckoutHandler({
    adminClient: () => { throw new Error('DB must not run'); },
  });
  const result = await responseJson(await handler({
    request: rawRequest(
      checkoutJsonWithByteLength((64 * 1024) + 1),
      { 'content-length': String((64 * 1024) + 1) },
    ),
    env: {},
  }));

  assert.deepEqual(result, { status: 413, body: { error: 'request_too_large' } });
});

test('checkout streamed cap rejects false and missing content-length values', async () => {
  for (const contentLength of ['1', null]) {
    const headers = contentLength === null ? {} : { 'content-length': contentLength };
    const handler = createCheckoutHandler({
      adminClient: () => { throw new Error('DB must not run'); },
    });
    const result = await responseJson(await handler({
      request: rawRequest(checkoutJsonWithByteLength((64 * 1024) + 1), headers),
      env: {},
    }));

    assert.deepEqual(result, { status: 413, body: { error: 'request_too_large' } });
  }
});

test('checkout returns bad_request for invalid JSON and malformed body shape', async () => {
  for (const source of ['{"cart":', '[]']) {
    const handler = createCheckoutHandler({
      adminClient: () => { throw new Error('DB must not run'); },
    });
    const result = await responseJson(await handler({ request: rawRequest(source), env: {} }));
    assert.deepEqual(result, { status: 400, body: { error: 'bad_request' } });
  }
});

test('checkout rejects the removed legacy items cart alias', async () => {
  const result = await responseJson(await boundaryCheckoutHandler()({
    request: jsonRequest('https://masest.test/api/checkout', { items: [{ sku: 'VK-1', qty: 1 }] }),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground', APP_URL: 'https://masest.test' },
  }));

  assert.deepEqual(result, { status: 400, body: { error: 'cart_empty' } });
});

test('checkout accepts 50 distinct lines and rejects 51 before DB access', async () => {
  const fifty = Array.from({ length: 50 }, (_, index) => ({ sku: `VK-${index}`, qty: 1 }));
  const accepted = await responseJson(await boundaryCheckoutHandler()({
    request: jsonRequest('https://masest.test/api/checkout', { cart: fifty }),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground', APP_URL: 'https://masest.test' },
  }));
  assert.equal(accepted.status, 200);

  const rejected = await responseJson(await createCheckoutHandler({
    adminClient: () => { throw new Error('DB must not run'); },
  })({
    request: jsonRequest('https://masest.test/api/checkout', {
      cart: [...fifty, { sku: 'VK-50', qty: 1 }],
    }),
    env: {},
  }));
  assert.deepEqual(rejected, { status: 400, body: { error: 'bad_request' } });
});

test('checkout validates SKU type, trimmed length, and non-empty value', async () => {
  const acceptedSku = ` ${'S'.repeat(80)} `;
  const accepted = await responseJson(await boundaryCheckoutHandler()({
    request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: acceptedSku, qty: 1 }] }),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground', APP_URL: 'https://masest.test' },
  }));
  assert.equal(accepted.status, 200);

  for (const sku of ['', '   ', 'S'.repeat(81), 123]) {
    const result = await responseJson(await createCheckoutHandler({
      adminClient: () => { throw new Error('DB must not run'); },
    })({
      request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku, qty: 1 }] }),
      env: {},
    }));
    assert.deepEqual(result, { status: 400, body: { error: 'bad_request' } });
  }
});

test('checkout accepts integer quantities 1 through 999 only', async () => {
  for (const qty of [1, 999]) {
    const result = await responseJson(await boundaryCheckoutHandler()({
      request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: 'VK-1', qty }] }),
      env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_SHIPPING_RATE_IDS: 'shr_ground', APP_URL: 'https://masest.test' },
    }));
    assert.equal(result.status, 200);
  }

  for (const qty of [0, 1000, 1.5, '1', null]) {
    const result = await responseJson(await createCheckoutHandler({
      adminClient: () => { throw new Error('DB must not run'); },
    })({
      request: jsonRequest('https://masest.test/api/checkout', { cart: [{ sku: 'VK-1', qty }] }),
      env: {},
    }));
    assert.deepEqual(result, { status: 400, body: { error: 'bad_request' } });
  }
});

test('checkout rejects duplicate-SKU quantities whose normalized total exceeds 999', async () => {
  const handler = createCheckoutHandler({
    adminClient: () => { throw new Error('DB must not run'); },
  });
  const result = await responseJson(await handler({
    request: jsonRequest('https://masest.test/api/checkout', {
      cart: [{ sku: 'VK-1', qty: 500 }, { sku: 'VK-1', qty: 500 }],
    }),
    env: {},
  }));

  assert.deepEqual(result, { status: 400, body: { error: 'bad_request' } });
});

test('checkout allows 20 attempts per IP per 60 seconds and denies the 21st', async () => {
  const store = new Map();
  const env = {
    RATE_KV: {
      async get(key) { return store.get(key); },
      async put(key, value) { store.set(key, value); },
    },
  };
  const handler = createCheckoutHandler();

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await responseJson(await handler({
      request: jsonRequest(
        'https://masest.test/api/checkout',
        { cart: [] },
        { 'cf-connecting-ip': '203.0.113.10' },
      ),
      env,
    }));
    assert.deepEqual(result, { status: 400, body: { error: 'cart_empty' } });
  }

  const denied = await responseJson(await handler({
    request: jsonRequest(
      'https://masest.test/api/checkout',
      { cart: [] },
      { 'cf-connecting-ip': '203.0.113.10' },
    ),
    env,
  }));
  assert.deepEqual(denied, { status: 429, body: { error: 'rate_limited' } });
});

test('checkout rate denial precedes body parsing, DB access, and Stripe calls', async () => {
  const calls = [];
  const handler = createCheckoutHandler({
    rateLimit: async () => {
      calls.push('rate');
      return { ok: false, retryAfter: 60 };
    },
    readBoundedJson: async () => {
      calls.push('body');
      return { cart: [{ sku: 'VK-1', qty: 1 }] };
    },
    adminClient: () => {
      calls.push('db');
      throw new Error('DB must not run');
    },
    createStripe: () => {
      calls.push('stripe');
      throw new Error('Stripe must not run');
    },
  });
  const request = rawRequest('{"cart":[{"sku":"VK-1","qty":1}]}');

  const result = await responseJson(await handler({ request, env: {} }));

  assert.deepEqual(result, { status: 429, body: { error: 'rate_limited' } });
  assert.deepEqual(calls, ['rate']);
  assert.equal(request.body.locked, false);
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

function webhookDb(calls, persistResults, effectResults = []) {
  return {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'persist_stripe_order') return persistResults.shift();
      if (name === 'link_order_provider_object') return { data: `link-${args.p_object_type}`, error: null };
      if (name === 'ingest_integration_event') {
        calls.push(['effects.ingest', args.p_effects, args]);
        return effectResults.shift() || { data: 'integration-event-1', error: null };
      }
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
      if (table === 'orders') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            calls.push('orders.effect-recovery');
            return { data: { id: 'order-1', order_number: 'MST-00000123', company_id: null }, error: null };
          },
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

test('webhook hydrates an incomplete checkout event before persisting the paid order', async () => {
  const calls = [];
  const complete = paidSession();
  complete.metadata.company_id = 'company-1';
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          ...complete,
          metadata: {},
          customer_details: null,
        },
      },
    }),
    retrieveCheckoutSession: async (id) => {
      calls.push(['stripe.session.retrieve', id]);
      return complete;
    },
    updateCheckoutSession: async (id, params) => { calls.push(['stripe.session.update', id, params]); },
    adminClient: () => webhookDb(calls, [{ data: { id: 'order-1' }, error: null }]),
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));

  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.deepEqual(calls[0], ['stripe.session.retrieve', 'cs_1']);
  const persist = calls.find((call) => Array.isArray(call) && call[0] === 'rpc.persist_stripe_order');
  assert.equal(persist[1].p_order.company_id, 'company-1');
  assert.equal(persist[1].p_order.customer_email, 'buyer@example.com');
  assert.deepEqual(persist[1].p_items, [{
    order_id: null,
    sku: 'VK-1',
    product_sku: 'VK',
    name: 'VertKleen - 1 gal',
    qty: 1,
    unit_price: 25,
    line_total: 25,
    backordered: false,
  }]);
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === 'rpc.link_order_provider_object')
    .map((call) => [call[1].p_object_type, call[1].p_provider_object_id]), [
    ['checkout_session', 'cs_1'],
    ['payment_intent', 'pi_1'],
  ]);
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'stripe.session.update'), [
    'stripe.session.update',
    'cs_1',
    { metadata: { order_number: 'MST-00000123' } },
  ]);
});

test('duplicate webhook delivery recovers and enqueues the same effects before 200', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ id: 'evt_checkout', type: 'checkout.session.completed', data: { object: paidSession() } }),
    updateCheckoutSession: async () => {},
    adminClient: () => webhookDb(calls, [{ data: null, error: { code: '23505' } }]),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 200, body: { received: true, duplicate: true } });
  assert.equal(calls.includes('orders.effect-recovery'), true);
  const enqueue = calls.find((call) => Array.isArray(call) && call[0] === 'effects.ingest');
  assert.ok(enqueue);
  assert.deepEqual({
    provider: enqueue[2].p_provider,
    eventId: enqueue[2].p_provider_event_id,
    effectKeys: enqueue[2].p_effects.map((effect) => effect.effect_key),
  }, {
    provider: 'stripe',
    eventId: 'evt_checkout',
    effectKeys: ['stock-decrement', 'oversell-alert', 'buyer-confirmation'],
  });
});

test('webhook persistence failure retries; effects enqueue only after durable order', async () => {
  const calls = [];
  const persistResults = [
    { data: null, error: { code: '08006', message: 'connection failure' } },
    { data: { id: 'order-1' }, error: null },
  ];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({ id: 'evt_checkout', type: 'checkout.session.completed', data: { object: paidSession() } }),
    updateCheckoutSession: async () => {},
    adminClient: () => webhookDb(calls, persistResults),
  });

  const first = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(first, { status: 503, body: { error: 'order_persist_failed' } });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'effects.ingest'), false);

  const second = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(second.status, 200);
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  const successfulPersist = labels.lastIndexOf('rpc.persist_stripe_order');
  const enqueue = labels.indexOf('effects.ingest');
  assert.ok(successfulPersist < enqueue);
  assert.equal(labels.filter((label) => label === 'effects.ingest').length, 1);
});

test('webhook enqueue failure prevents acknowledgement after order persistence', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: { object: paidSession() },
    }),
    updateCheckoutSession: async () => {},
    adminClient: () => webhookDb(
      calls,
      [{ data: { id: 'order-1' }, error: null }],
      [{ data: null, error: { code: 'effects_unavailable' } }],
    ),
  });
  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 503, body: { error: 'stripe_effect_enqueue_failed' } });
});

test('quoted Stripe sessions finalize card orders but retain ACH drafts while pending', async () => {
  for (const paymentStatus of ['paid', 'unpaid']) {
    const calls = [];
    const transitions = [];
    const session = paidSession();
    session.payment_status = paymentStatus;
    session.metadata.quote_id = 'quote-1';
    session.metadata.quote_order_id = 'draft-1';
    const handler = createStripeWebhookHandler({
      constructEvent: async () => ({
        id: `evt_${paymentStatus}`,
        type: 'checkout.session.completed',
        data: { object: session },
      }),
      updateCheckoutSession: async () => {},
      adminClient: () => webhookDb(calls, [{ data: { id: 'order-1' }, error: null }]),
      finalizeQuoteOrder: async (_sb, input) => {
        transitions.push(['finalize', input]);
        return { ok: true };
      },
      markQuotePaymentPending: async (_sb, input) => {
        transitions.push(['pending', input]);
        return { ok: true };
      },
    });

    const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
    assert.equal(result.status, 200);
    assert.deepEqual(transitions, [[paymentStatus === 'paid' ? 'finalize' : 'pending', {
      quoteId: 'quote-1',
      draftOrderId: 'draft-1',
      finalOrderId: 'order-1',
    }]]);
  }
});

function achDb(calls, claimResults) {
  let orderReads = 0;
  return {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      if (name === 'ingest_integration_event') {
        calls.push(['effects.ingest', args.p_effects, args]);
        return { data: 'integration-event-1', error: null };
      }
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
              const status = orderReads++ === 0 ? 'pending_payment' : 'paid';
              return { data: { id: 'order-1', status, company_id: null }, error: null };
            }
            return claimResults.shift();
          },
        };
      }
      throw new Error(`unexpected ACH table: ${table}`);
    },
  };
}

test('concurrent ACH success deliveries have one claim and duplicate-safe effect enqueue', async () => {
  const calls = [];
  const db = achDb(calls, [
    { data: { id: 'order-1', status: 'paid', company_id: null }, error: null },
    { data: null, error: null },
  ]);
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_ach_success',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: paidSession() },
    }),
    adminClient: () => db,
  });

  const first = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  const second = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));

  assert.equal(first.status, 200);
  assert.deepEqual(second, { status: 200, body: { received: true, duplicate: true } });
  const labels = calls.map((call) => Array.isArray(call) ? call[0] : call);
  assert.equal(labels.filter((label) => label === 'orders.claim').length, 1);
  assert.equal(labels.filter((label) => label === 'effects.ingest').length, 2);
  const enqueues = calls.filter((call) => Array.isArray(call) && call[0] === 'effects.ingest');
  assert.deepEqual(enqueues[0][1], enqueues[1][1]);
});

test('successful quoted ACH payment finalizes the pending quote', async () => {
  const calls = [];
  const finalized = [];
  const session = paidSession();
  session.metadata.quote_id = 'quote-1';
  session.metadata.quote_order_id = 'draft-1';
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_quoted_ach_success',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: session },
    }),
    adminClient: () => achDb(calls, [
      { data: { id: 'order-1', status: 'paid', company_id: null }, error: null },
    ]),
    finalizeQuoteOrder: async (_sb, input) => {
      finalized.push(input);
      return { ok: true };
    },
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(result.status, 200);
  assert.deepEqual(finalized, [{
    quoteId: 'quote-1',
    draftOrderId: 'draft-1',
    finalOrderId: 'order-1',
  }]);
});

test('ACH claim failure returns retryable 503 before stock decrement', async () => {
  const calls = [];
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_ach_success',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: paidSession() },
    }),
    adminClient: () => achDb(calls, [{ data: null, error: { message: 'DB unavailable' } }]),
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.deepEqual(result, { status: 503, body: { error: 'order_update_failed' } });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'effects.ingest'), false);
});

test('test-mode ACH settlement remains outside the production QBO queue', async () => {
  const calls = [];
  const session = { ...paidSession(), livemode: false };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_test_ach_success',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: session },
    }),
    adminClient: () => achDb(calls, [
      { data: { id: 'order-1', status: 'paid', company_id: null }, error: null },
    ]),
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(result.status, 200);
  assert.equal(
    calls.find((call) => Array.isArray(call) && call[0] === 'orders.claim')[1].qbo_sync_status,
    'skipped',
  );
});

test('failed quoted ACH payment reopens the accepted draft after cancelling its order', async () => {
  const calls = [];
  const reopened = [];
  const session = paidSession();
  session.metadata.quote_id = 'quote-1';
  session.metadata.quote_order_id = 'draft-1';
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_ach_failed',
      type: 'checkout.session.async_payment_failed',
      data: { object: session },
    }),
    adminClient: () => achDb(calls, [
      { data: { id: 'order-1', status: 'cancelled', company_id: null }, error: null },
    ]),
    reopenQuoteAfterPaymentFailure: async (_sb, input) => {
      reopened.push(input);
      return { ok: true };
    },
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(result.status, 200);
  assert.deepEqual(reopened, [{
    quoteId: 'quote-1',
    draftOrderId: 'draft-1',
    finalOrderId: 'order-1',
  }]);
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

test('refund queue retries before order reconciliation and accepts duplicate replay', async () => {
  const calls = [];
  const queueResults = [
    { data: null, error: { message: 'QBO queue unavailable' } },
    { data: null, error: { code: '23505', message: 'duplicate refund id' } },
  ];
  const db = {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      assert.equal(name, 'link_order_provider_object');
      return { data: `link-${args.p_provider_object_id}`, error: null };
    },
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
              data: {
                id: 'order-1',
                order_number: 'MST-00000123',
                company_id: 'company-1',
                status: 'paid',
                total: 25,
                refunded_amount: 0,
              },
              error: null,
            };
          },
        };
      }
      if (table === 'qbo_refunds') {
        return {
          async insert(row) { calls.push(['qbo_refunds.insert', row]); return queueResults.shift(); },
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
  assert.equal(labels.filter((label) => label === 'rpc.link_order_provider_object').length, 2);
  assert.equal(labels.filter((label) => label === 'qbo_refunds.insert').length, 2);
  assert.equal(labels.filter((label) => label === 'orders.update').length, 1);
  assert.ok(labels.lastIndexOf('rpc.link_order_provider_object') < labels.lastIndexOf('qbo_refunds.insert'));
  assert.ok(labels.lastIndexOf('qbo_refunds.insert') < labels.indexOf('orders.update'));
});

test('refund of a QBO-skipped Stripe test order never queues a production credit memo', async () => {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push([`rpc.${name}`, args]);
      assert.equal(name, 'link_order_provider_object');
      return { data: `link-${args.p_provider_object_id}`, error: null };
    },
    from(table) {
      if (table !== 'orders') throw new Error(`unexpected refund table: ${table}`);
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
            data: {
              id: 'order-test',
              order_number: 'MST-00000124',
              company_id: 'company-1',
              status: 'paid',
              total: 25,
              refunded_amount: 0,
              qbo_sync_status: 'skipped',
            },
            error: null,
          };
        },
      };
    },
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test',
          payment_intent: 'pi_test',
          amount_refunded: 2500,
          refunds: { data: [{ id: 're_test', amount: 2500, status: 'succeeded' }] },
        },
      },
    }),
    adminClient: () => db,
  });

  const result = await responseJson(await handler({ request: webhookRequest(), env: webhookEnv }));
  assert.equal(result.status, 200);
  assert.equal(calls.filter(([label]) => label === 'rpc.link_order_provider_object').length, 1);
  assert.equal(calls.filter(([label]) => label === 'orders.update').length, 1);
});
