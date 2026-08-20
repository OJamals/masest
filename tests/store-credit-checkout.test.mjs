import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckoutHandler } from '../functions/api/checkout.js';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';

function db() {
  return {
    from(table) {
      if (table === 'product_variants') {
        return {
          select() { return this; },
          async in() {
            return {
              data: [{
                vsku: 'VK-1', product_sku: 'VK', label: '1 gal', price: 25,
                currency: 'usd', stripe_price_id: 'price_catalog', active: true,
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
          select() { return this; },
          eq() { return this; },
          async order() { return { data: [], error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('account checkout reserves once, reprices merchandise, and binds Stripe idempotency before attach', async () => {
  const calls = [];
  let sessionParams;
  let sessionOptions;
  const handler = createCheckoutHandler({
    resolveCommerceContext: async () => ({
      sb: db(),
      user: { id: USER_ID, email: 'buyer@example.test' },
      userId: USER_ID,
      profile: { company_id: COMPANY_ID },
      company: { id: COMPANY_ID, name: 'Buyer Co', status: 'approved' },
      companyId: COMPANY_ID,
      tier: 'retail',
      taxExempt: false,
    }),
    ensureCompanyStripeCustomer: async () => 'cus_company',
    validateShippingRates: async () => null,
    now: () => new Date('2026-08-20T12:00:00Z'),
    reserveCompanyStoreCredit: async (_sb, input) => {
      calls.push(['reserve', input]);
      return { id: RESERVATION_ID, amount_minor: 1001, currency: 'usd', status: 'reserved' };
    },
    attachCompanyStoreCreditReservation: async (_sb, input) => {
      calls.push(['attach', input]);
      return { id: RESERVATION_ID, status: 'attached' };
    },
    createStripe: () => ({
      checkout: { sessions: { async create(params, options) {
        calls.push(['stripe', options]);
        sessionParams = params;
        sessionOptions = options;
        return { id: 'cs_credit', url: 'https://checkout.stripe.test/credit' };
      } } },
    }),
  });

  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'pay',
        email: 'buyer@example.test',
        cart: [{ sku: 'VK-1', qty: 2 }],
        apply_store_credit: true,
        checkout_intent_id: INTENT_ID,
      }),
    }),
    env: {
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_SHIPPING_RATE_IDS: 'shr_ground',
      APP_URL: 'https://masest.test',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(sessionParams.metadata.store_credit_reservation_id, RESERVATION_ID);
  assert.equal(sessionParams.metadata.store_credit_amount_minor, '1001');
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 1999);
  assert.equal(sessionParams.line_items[1].price_data.unit_amount, 2000);
  assert.deepEqual(sessionOptions, { idempotencyKey: `store-credit-checkout:${RESERVATION_ID}` });
  assert.equal(sessionParams.expires_at, Date.parse('2026-08-20T12:35:00Z') / 1000);
  assert.equal(calls[0][1].expiresAt, '2026-08-20T12:35:00.000Z');
  assert.deepEqual(calls.map(([name]) => name), ['reserve', 'stripe', 'attach']);
});

test('account credit stays unavailable until the Company is approved', async () => {
  const handler = createCheckoutHandler({
    resolveCommerceContext: async () => ({
      sb: { from() { throw new Error('pricing DB must not run'); } },
      user: { id: USER_ID, email: 'buyer@example.test' },
      userId: USER_ID,
      profile: { company_id: COMPANY_ID },
      company: { id: COMPANY_ID, status: 'pending' },
      companyId: COMPANY_ID,
      tier: 'retail',
      taxExempt: false,
    }),
  });
  const response = await handler({
    request: new Request('https://masest.test/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'pay',
        email: 'buyer@example.test',
        cart: [{ sku: 'VK-1', qty: 1 }],
        apply_store_credit: true,
        checkout_intent_id: INTENT_ID,
      }),
    }),
    env: {},
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'store_credit_account_required' });
});
