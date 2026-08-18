import assert from 'node:assert/strict';
import test from 'node:test';

import { CommerceContextError } from '../functions/_lib/commerce-context.js';
import { createCheckoutHandler } from '../functions/api/checkout.js';
import {
  ShippingRequestError,
  createShippingRequestCoordinator,
  fetchShippingJson,
  shippingRequestSnapshot,
} from '../js/shipping-request.js';

test('Checkout stops on a typed commerce-context read failure before pricing or Stripe', async () => {
  const calls = [];
  const handler = createCheckoutHandler({
    resolveCommerceContext: async () => {
      calls.push('context');
      throw new CommerceContextError('profile');
    },
    adminClient: () => { calls.push('database'); throw new Error('must not run'); },
    createStripe: () => { calls.push('stripe'); throw new Error('must not run'); },
  });
  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@example.test', cart: [{ sku: 'VK-1', qty: 1 }] }),
    }),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'commerce_context_unavailable', retryable: true });
  assert.deepEqual(calls, ['context']);
});

test('Checkout uses one Company snapshot for tier price, tax, Customer, ownership, and recipient', async () => {
  const calls = [];
  const sb = {
    from(table) {
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in(_column, skus) {
            calls.push(['variants', skus]);
            return {
              data: [{
                vsku: 'VK-1', product_sku: 'VK', label: '1 gal', price: 25,
                currency: 'usd', stripe_price_id: null, active: true,
                stock: 10, track_stock: true, allow_backorder: false,
                products: { name: 'VertKleen', mode: 'buy', active: true, taxable: true },
              }],
              error: null,
            };
          },
        };
      }
      if (table === 'content_entries') {
        return {
          select() { return this; }, eq() { return this; },
          async order() { return { data: [], error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const company = {
    id: 'company-1', name: 'Acme HVAC', status: 'approved', price_tier: 'dealer',
    tax_exempt: true, stripe_customer_id: 'cus_shared',
  };
  const context = Object.freeze({
    kind: 'company_user',
    sb,
    user: { id: 'buyer-1', email: 'buyer@example.test' },
    userId: 'buyer-1',
    profile: { id: 'buyer-1', company_id: company.id, role: 'buyer' },
    company,
    companyId: company.id,
    tier: 'dealer',
    taxExempt: true,
    stripeCustomerId: 'cus_shared',
    account: { companyId: company.id, role: 'buyer' },
  });
  let sessionParams;
  const handler = createCheckoutHandler({
    resolveCommerceContext: async () => {
      calls.push('context');
      return context;
    },
    tierPriceMap: async (receivedDb, tier) => {
      assert.equal(receivedDb, sb);
      assert.equal(tier, 'dealer');
      calls.push('tier');
      return new Map([['VK-1', 19]]);
    },
    ensureCompanyStripeCustomer: async ({ sb: receivedDb, company: receivedCompany, email }) => {
      assert.equal(receivedDb, sb);
      assert.equal(receivedCompany, company);
      assert.equal(email, 'buyer@example.test');
      calls.push('customer');
      return 'cus_shared';
    },
    validateShippingRates: async () => null,
    createStripe: () => ({
      customers: {
        async update(customerId, patch) {
          calls.push(['tax', customerId, patch]);
        },
      },
      checkout: {
        sessions: {
          async create(params) {
            sessionParams = params;
            calls.push('stripe');
            return { url: 'https://checkout.stripe.test/session' };
          },
        },
      },
    }),
  });

  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@example.test', cart: [{ sku: 'VK-1', qty: 1 }] }),
    }),
    env: {
      APP_URL: 'https://masest.test',
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_SHIPPING_RATE_IDS: 'shr_ground',
      STRIPE_TAX_ENABLED: 'true',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(sessionParams.customer, 'cus_shared');
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 1900);
  assert.equal(sessionParams.metadata.company_id, 'company-1');
  assert.equal(sessionParams.metadata.buyer_user_id, 'buyer-1');
  assert.equal(sessionParams.metadata.buyer_email, 'buyer@example.test');
  assert.deepEqual(calls, [
    'context',
    ['variants', ['VK-1']],
    'tier',
    'customer',
    ['tax', 'cus_shared', { tax_exempt: 'exempt' }],
    'stripe',
  ]);
});

test('Checkout fails closed on a tier-price read error before Stripe access', async () => {
  const calls = [];
  const sb = {
    from(table) {
      assert.equal(table, 'product_variants');
      return {
        select() { return this; },
        async in() {
          calls.push('variants');
          return {
            data: [{
              vsku: 'VK-1', product_sku: 'VK', label: '1 gal', price: 25,
              currency: 'usd', active: true, stock: 10, track_stock: true,
              allow_backorder: false,
              products: { name: 'VertKleen', mode: 'buy', active: true, taxable: true },
            }],
            error: null,
          };
        },
      };
    },
  };
  const handler = createCheckoutHandler({
    resolveCommerceContext: async () => ({
      sb,
      user: { id: 'buyer-1', email: 'buyer@example.test' },
      userId: 'buyer-1',
      profile: { id: 'buyer-1', company_id: 'company-1' },
      company: { id: 'company-1' },
      companyId: 'company-1',
      tier: 'dealer',
      taxExempt: false,
    }),
    tierPriceMap: async () => {
      calls.push('pricing');
      throw new CommerceContextError('pricing');
    },
    createStripe: () => {
      calls.push('stripe');
      throw new Error('Stripe must not run');
    },
  });
  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@example.test', cart: [{ sku: 'VK-1', qty: 1 }] }),
    }),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'commerce_context_unavailable', retryable: true });
  assert.deepEqual(calls, ['variants', 'pricing']);
});

test('Checkout rejects a shipping quote whose currency differs from the priced cart', async () => {
  let stripeAccessed = false;
  const address = {
    name: 'Buyer', company: '', phone: '321-555-0100', address1: '100 Main St', address2: '',
    city: 'Melbourne', state: 'FL', postal_code: '32901', country: 'US', residential: false,
  };
  const selection = {
    v: 3,
    plan_id: 'rate-1', plan_digest: 'plan', cart_digest: 'cart', address_digest: 'address',
    cart: [{ sku: 'VK-1', qty: 1 }], address, billing_address: address,
    billing_same_as_shipping: true,
    rate: {
      rate_id: 'rate-1', carrier_id: 'carrier-1', service_code: 'ground',
      amount_minor: 2000, currency: 'usd',
    },
  };
  const plan = {
    ...selection,
    contract_version: 3,
    rate_id: 'rate-1', carrier_id: 'carrier-1', service_code: 'ground',
    amount_minor: 2000, currency: 'usd', rate: selection.rate,
  };
  const sb = {
    from(table) {
      assert.equal(table, 'product_variants');
      return {
        select() { return this; },
        async in() {
          return { data: [{
            vsku: 'VK-1', product_sku: 'VK', label: '1 gal', price: 25,
            currency: 'eur', active: true, stock: 10, track_stock: true,
            allow_backorder: false,
            products: { name: 'VertKleen', mode: 'buy', active: true, taxable: true },
          }], error: null };
        },
      };
    },
  };
  const handler = createCheckoutHandler({
    rateLimit: async () => ({ ok: true }),
    resolveCommerceContext: async () => ({
      sb, user: null, userId: null, profile: null, company: null, companyId: null,
      tier: 'retail', taxExempt: false,
    }),
    verifyShippingSelectionToken: async () => selection,
    loadShippingQuotePlan: async () => ({ outcome: 'found', plan }),
    createStripe: () => { stripeAccessed = true; throw new Error('must not access Stripe'); },
  });
  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'buyer@example.test',
        cart: [{ sku: 'VK-1', qty: 1 }],
        shipping_quote_token: 'signed',
      }),
    }),
    env: { SHIPPING_QUOTE_SECRET: 'configured' },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'mixed_currency',
    message: 'Items in your cart use different currencies. Order them separately.',
  });
  assert.equal(stripeAccessed, false);
});

test('shipping request generation rejects a delayed old response after an edit', () => {
  const coordinator = createShippingRequestCoordinator();
  const firstSnapshot = shippingRequestSnapshot({
    cart: [{ sku: 'VK-1', qty: 1 }], postal_code: '32901',
  });
  const first = coordinator.begin(firstSnapshot);
  const secondSnapshot = shippingRequestSnapshot({
    cart: [{ sku: 'VK-1', qty: 2 }], postal_code: '32901',
  });
  const second = coordinator.begin(secondSnapshot);

  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.isCurrent(first, firstSnapshot), false);
  assert.equal(coordinator.isCurrent(second, secondSnapshot), true);
  assert.equal(coordinator.isCurrent(second, firstSnapshot), false);
});

test('browser composite shipping requests abort on a bounded deadline with a stable retryable code', async () => {
  await assert.rejects(
    fetchShippingJson('/api/shipping-rates', {}, {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    }),
    (error) => error instanceof ShippingRequestError
      && error.code === 'shipping_rates_timeout'
      && error.retryable === true,
  );
});
