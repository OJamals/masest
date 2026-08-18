import assert from 'node:assert/strict';
import test from 'node:test';

import { validateGoogleAddress } from '../functions/_lib/address-validation.js';
import { shipStationRequest } from '../functions/_lib/shipstation.js';
import { createStripeWebhookHandler } from '../functions/api/stripe-webhook.js';
import {
  CheckoutShippingError,
  assertShippingPlanSelection,
  loadShippingQuotePlan,
  quoteCheckoutRates,
  verifyShippingSelectionToken,
} from '../functions/_lib/checkout-shipping.js';

const address = {
  name: 'Buyer One', company: 'Acme', phone: '321-555-0100',
  address1: '100 Main St', address2: '', city: 'Melbourne', state: 'FL',
  postal_code: '32901', country: 'US', residential: false,
};
const variants = [{
  vsku: 'VK-1', product_sku: 'VK', label: '1 gal', price: 25, active: true,
  shipping_weight_lb: 10, shipping_length_in: 6, shipping_width_in: 6, shipping_height_in: 12,
  products: { name: 'VertKleen', mode: 'buy', active: true },
}];
const env = {
  SHIPSTATION_API_KEY: 'configured',
  SHIPSTATION_WAREHOUSE_ID: 'warehouse-1',
  SHIPPING_QUOTE_SECRET: 'q'.repeat(48),
};

function dependencies(overrides = {}) {
  return {
    now: () => 1_700_000_000_000,
    validateAddress: async (value) => ({ address: value, corrected: false }),
    listCarriers: async () => ({ carriers: [{ carrier_id: 'carrier-1' }] }),
    quoteRates: async () => ({ rate_response: { rates: [{
      rate_id: 'rate-1', carrier_id: 'carrier-1', carrier_name: 'Carrier',
      service_code: 'ground', service_type: 'Ground',
      shipping_amount: { amount: 20, currency: 'usd' },
    }] } }),
    ...overrides,
  };
}

test('a purchasable rate is signed only after its exact carton plan is durably stored', async () => {
  let persisted;
  const quote = await quoteCheckoutRates({
    env, cart: [{ sku: 'VK-1', qty: 2 }], address, email: 'buyer@example.test', variants,
  }, dependencies({
    persistShippingQuotes: async (_env, rows) => {
      persisted = structuredClone(rows);
      return { ok: true, count: rows.length };
    },
  }));

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].contract_version, 3);
  assert.equal(persisted[0].plan_id, 'rate-1');
  assert.match(persisted[0].plan_digest, /^[A-Za-z0-9_-]{43}$/);
  assert.match(persisted[0].cart_digest, /^[A-Za-z0-9_-]{43}$/);
  assert.match(persisted[0].address_digest, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(persisted[0].packages[0].weight.value, 20);

  const selection = await verifyShippingSelectionToken({
    secret: env.SHIPPING_QUOTE_SECRET,
    token: quote.rates[0].token,
    cart: [{ sku: 'VK-1', qty: 2 }],
    now: () => 1_700_000_100_000,
  });
  assert.equal(selection.v, 3);
  assert.equal(selection.plan_id, persisted[0].plan_id);
  assert.equal(selection.plan_digest, persisted[0].plan_digest);
  assert.equal(selection.cart_digest, persisted[0].cart_digest);
  assert.equal(selection.address_digest, persisted[0].address_digest);
  assert.equal(selection.rate.amount_minor, persisted[0].amount_minor);
  assert.deepEqual(assertShippingPlanSelection(selection, { outcome: 'found', plan: persisted[0] }), persisted[0]);
});

test('a carton-plan write failure is retryable and no signed rate escapes', async () => {
  await assert.rejects(
    quoteCheckoutRates({
      env, cart: [{ sku: 'VK-1', qty: 1 }], address, email: 'buyer@example.test', variants,
    }, dependencies({ persistShippingQuotes: async () => ({ ok: false, error: { code: '08006' } }) })),
    (error) => error instanceof CheckoutShippingError
      && error.code === 'shipping_plan_store_unavailable'
      && error.status === 503,
  );
});

test('malformed provider rows are skipped without taking down a valid purchasable rate', async () => {
  let persisted;
  const quote = await quoteCheckoutRates({
    env, cart: [{ sku: 'VK-1', qty: 1 }], address, email: 'buyer@example.test', variants,
  }, dependencies({
    listCarriers: async () => ({ carriers: [
      { carrier_id: `bad\ncarrier` },
      { carrier_id: 'carrier-1' },
    ] }),
    quoteRates: async (_env, payload) => {
      assert.deepEqual(payload.rate_options.carrier_ids, ['carrier-1']);
      return { rate_response: { rates: [
        {
          rate_id: `bad\nrate`, carrier_id: 'carrier-1', service_code: 'bad',
          shipping_amount: { amount: 1, currency: 'usd' },
        },
        {
          rate_id: 'rate-1', carrier_id: 'carrier-1', carrier_name: 'Carrier',
          service_code: 'ground', service_type: 'Ground',
          shipping_amount: { amount: 20, currency: 'usd' },
        },
      ] } };
    },
    persistShippingQuotes: async (_env, rows) => {
      persisted = rows;
      return { ok: true, count: rows.length };
    },
  }));
  assert.equal(quote.rates.length, 1);
  assert.equal(quote.rates[0].rate_id, 'rate-1');
  assert.equal(persisted.length, 1);
});

test('carton-plan reads distinguish not-found from storage failure', async () => {
  const notFound = await loadShippingQuotePlan({}, 'rate-missing', {
    sb: { from: () => ({
      select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: null, error: null }; },
    }) },
  });
  assert.deepEqual(notFound, { outcome: 'not_found', plan: null });

  await assert.rejects(
    loadShippingQuotePlan({}, 'rate-1', {
      sb: { from: () => ({
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: null, error: { code: '08006' } }; },
      }) },
    }),
    (error) => error.code === 'shipping_plan_store_unavailable' && error.status === 503,
  );
});

test('stored-plan mismatch is distinct from a missing plan', () => {
  assert.throws(
    () => assertShippingPlanSelection({ v: 3, plan_id: 'rate-1', plan_digest: 'signed' }, {
      outcome: 'found', plan: { plan_id: 'rate-1', plan_digest: 'different' },
    }),
    (error) => error.code === 'shipping_plan_mismatch',
  );
  assert.throws(
    () => assertShippingPlanSelection({ v: 3, plan_id: 'rate-1', plan_digest: 'signed' }, {
      outcome: 'not_found', plan: null,
    }),
    (error) => error.code === 'shipping_plan_not_found',
  );
});

function abortingProvider(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

async function stalledProviderBody(_url, { signal }) {
  return {
    ok: true,
    json: async () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  };
}

test('Google and ShipStation adapters expose bounded, stable timeout errors', async () => {
  await assert.rejects(
    validateGoogleAddress(address, { GC_ADDRESS_VALIDATION_API_KEY: 'configured' }, {
      fetchImpl: abortingProvider,
      timeoutMs: 5,
    }),
    (error) => error.code === 'address_validation_timeout' && error.status === 503,
  );
  await assert.rejects(
    shipStationRequest({ SHIPSTATION_API_KEY: 'configured' }, '/carriers', {}, {
      fetchImpl: abortingProvider,
      timeoutMs: 5,
    }),
    (error) => error.code === 'shipstation_timeout' && error.status === 503,
  );
  await assert.rejects(
    validateGoogleAddress(address, { GC_ADDRESS_VALIDATION_API_KEY: 'configured' }, {
      fetchImpl: stalledProviderBody,
      timeoutMs: 5,
    }),
    (error) => error.code === 'address_validation_timeout' && error.status === 503,
  );
  await assert.rejects(
    shipStationRequest({ SHIPSTATION_API_KEY: 'configured' }, '/carriers', {}, {
      fetchImpl: stalledProviderBody,
      timeoutMs: 5,
    }),
    (error) => error.code === 'shipstation_timeout' && error.status === 503,
  );
});

function stripeEventRequest() {
  return new Request('https://masest.test/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 'test-signature' }, body: '{}',
  });
}

function currentSession() {
  return {
    id: 'cs_current', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_current',
    amount_subtotal: 2500, amount_total: 4500, currency: 'usd',
    shipping_cost: { amount_subtotal: 2000 },
    total_details: { amount_tax: 0, amount_shipping: 2000 },
    metadata: {
      cart: JSON.stringify([{ s: 'VK-1', ps: 'VK', q: 1, p: 25 }]),
      buyer_email: 'buyer@example.test',
      buyer_user_id: '11111111-1111-4111-8111-111111111111',
      shipping_contract_version: '3',
      shipping_plan_id: 'rate-1',
      shipping_plan_digest: 'plan-digest',
      shipping_cart_digest: 'cart-digest',
      shipping_address_digest: 'address-digest',
      shipping_rate_id: 'rate-1',
      shipping_carrier_id: 'carrier-1',
      shipping_service_code: 'ground',
      shipping_amount_minor: '2000',
      shipping_currency: 'usd',
    },
  };
}

test('current webhook refuses to acknowledge payment when its bound plan is missing', async () => {
  let persisted = false;
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_current', type: 'checkout.session.completed', data: { object: currentSession() },
    }),
    loadShippingQuotePlan: async () => ({ outcome: 'not_found', plan: null }),
    adminClient: () => ({
      from(table) {
        if (table === 'product_variants') return {
          select() { return this; }, async in() { return { data: [], error: null }; },
        };
        throw new Error(`unexpected table ${table}`);
      },
      async rpc() { persisted = true; throw new Error('must not persist'); },
    }),
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'shipping_plan_not_found' });
  assert.equal(persisted, false);
});

test('current webhook atomically persists the exact bound cartons, Buyer, and recipient', async () => {
  const session = currentSession();
  session.customer_details = { email: 'shared-company@example.test' };
  const packages = [{
    package_code: 'package',
    weight: { value: 10, unit: 'pound' },
    dimensions: { unit: 'inch', length: 6, width: 6, height: 12 },
  }];
  const plan = {
    contract_version: 3,
    plan_id: 'rate-1',
    plan_digest: 'plan-digest',
    cart_digest: 'cart-digest',
    address_digest: 'address-digest',
    rate_id: 'rate-1',
    carrier_id: 'carrier-1',
    service_code: 'ground',
    amount_minor: 2000,
    currency: 'usd',
    cart: [{ sku: 'VK-1', qty: 1 }],
    address,
    packages,
  };
  const captured = {};
  const db = {
    async rpc(name, args) {
      if (name === 'persist_stripe_order') {
        captured.order = args.p_order;
        return { data: { id: 'order-1' }, error: null };
      }
      if (name === 'link_order_provider_object') return { data: 'link-1', error: null };
      if (name === 'ingest_provider_event') return { data: 'event-1', error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) {
      if (table === 'product_variants') return {
        select() { return this; }, async in() { return { data: [], error: null }; },
      };
      if (table === 'orders') return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          return { data: { id: 'order-1', order_number: 'MST-1', company_id: null }, error: null };
        },
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_bound', type: 'checkout.session.completed', data: { object: session },
    }),
    loadShippingQuotePlan: async () => ({ outcome: 'found', plan }),
    updateCheckoutSession: async () => {},
    adminClient: () => db,
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(captured.order.shipping_package_plan, packages);
  assert.equal(captured.order.fulfillment_contract_status, 'bound');
  assert.equal(captured.order.shipstation_error, null);
  assert.equal(captured.order.user_id, session.metadata.buyer_user_id);
  assert.equal(captured.order.customer_email, 'buyer@example.test');
  assert.equal(captured.order.ship_address.address.line1, address.address1);
  assert.equal(captured.order.ship_address.address.postal_code, address.postal_code);
});

test('current webhook rejects Session cart metadata that no longer matches the bound carton plan', async () => {
  const session = currentSession();
  session.metadata.cart = JSON.stringify([{ s: 'VK-1', ps: 'VK', q: 2, p: 25 }]);
  let persisted = false;
  const plan = {
    contract_version: 3,
    plan_id: 'rate-1',
    plan_digest: 'plan-digest',
    cart_digest: 'cart-digest',
    address_digest: 'address-digest',
    rate_id: 'rate-1',
    carrier_id: 'carrier-1',
    service_code: 'ground',
    amount_minor: 2000,
    currency: 'usd',
    cart: [{ sku: 'VK-1', qty: 1 }],
    address,
    packages: [{ package_code: 'package', weight: { value: 10, unit: 'pound' } }],
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_cart_mismatch', type: 'checkout.session.completed', data: { object: session },
    }),
    loadShippingQuotePlan: async () => ({ outcome: 'found', plan }),
    adminClient: () => ({
      from(table) {
        if (table === 'product_variants') return {
          select() { return this; }, async in() { return { data: [], error: null }; },
        };
        throw new Error(`unexpected table ${table}`);
      },
      async rpc() { persisted = true; throw new Error('must not persist'); },
    }),
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'shipping_plan_mismatch' });
  assert.equal(persisted, false);
});

test('current webhook never falls back from a missing bound Buyer to a shared Customer email', async () => {
  const session = currentSession();
  delete session.metadata.buyer_email;
  session.customer_details = { email: 'shared-company@example.test' };
  let persisted = false;
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_recipient', type: 'checkout.session.completed', data: { object: session },
    }),
    retrieveCheckoutSession: async () => session,
    adminClient: () => ({
      from(table) {
        if (table === 'product_variants') return {
          select() { return this; }, async in() { return { data: [], error: null }; },
        };
        throw new Error(`unexpected table ${table}`);
      },
      async rpc() { persisted = true; },
    }),
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'checkout_session_incomplete' });
  assert.equal(persisted, false);
});

test('an unknown shipping contract cannot be downgraded to the legacy review path', async () => {
  const session = currentSession();
  session.metadata.shipping_contract_version = '4';
  let persisted = false;
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_unknown_contract', type: 'checkout.session.completed', data: { object: session },
    }),
    loadShippingQuotePlan: async () => { throw new Error('unknown contracts must not load a v3 plan'); },
    adminClient: () => ({
      from(table) {
        if (table === 'product_variants') return {
          select() { return this; }, async in() { return { data: [], error: null }; },
        };
        throw new Error(`unexpected table ${table}`);
      },
      async rpc() { persisted = true; },
    }),
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'shipping_contract_unsupported' });
  assert.equal(persisted, false);
});

test('legacy webhook persists an explicit manual-review marker and never loads a current plan', async () => {
  const session = currentSession();
  delete session.metadata.shipping_contract_version;
  const captured = {};
  const db = {
    async rpc(name, args) {
      if (name === 'persist_stripe_order') {
        captured.order = args.p_order;
        return { data: { id: 'order-1' }, error: null };
      }
      if (name === 'link_order_provider_object') return { data: 'link-1', error: null };
      if (name === 'ingest_provider_event') return { data: 'event-1', error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) {
      if (table === 'product_variants') return {
        select() { return this; }, async in() { return { data: [], error: null }; },
      };
      if (table === 'orders') return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          return { data: { id: 'order-1', order_number: 'MST-1', company_id: null }, error: null };
        },
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handler = createStripeWebhookHandler({
    constructEvent: async () => ({
      id: 'evt_legacy', type: 'checkout.session.completed', data: { object: session },
    }),
    loadShippingQuotePlan: async () => { throw new Error('legacy must not load a v3 plan'); },
    updateCheckoutSession: async () => {},
    adminClient: () => db,
  });
  const response = await handler({
    request: stripeEventRequest(),
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  });
  assert.equal(response.status, 200);
  assert.equal(captured.order.fulfillment_contract_status, 'legacy_review_required');
  assert.equal(captured.order.shipstation_error, 'shipping_package_plan_review_required');
});
