import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStripeCheckoutSessionParams,
  buyerEmailFromStripeSession,
  normalizeCheckoutBuyerEmail,
} from '../functions/_lib/checkout-session.js';

const base = {
  appUrl: 'https://masest.test',
  companyId: 'company-1',
  buyerUserId: 'buyer-1',
  customerId: 'cus_shared',
  sellable: [{ sku: 'VK-1', name: 'VertKleen', price: 25, currency: 'usd' }],
  qtyBySku: { 'VK-1': 1 },
};

test('Checkout validates and canonicalizes the active Buyer recipient', () => {
  assert.deepEqual(normalizeCheckoutBuyerEmail(' Buyer@One.Example '), { value: 'buyer@one.example' });
  for (const value of ['', 'buyer', 'buyer @example.test', `${'a'.repeat(250)}@x.test`]) {
    assert.deepEqual(normalizeCheckoutBuyerEmail(value), { error: 'buyer_email_invalid' });
  }
});

test('two Buyers sharing one Company Customer retain distinct immutable recipients', () => {
  const first = buildStripeCheckoutSessionParams({ ...base, email: 'first@example.test' });
  const second = buildStripeCheckoutSessionParams({ ...base, buyerUserId: 'buyer-2', email: 'second@example.test' });
  assert.equal(first.customer, 'cus_shared');
  assert.equal(second.customer, 'cus_shared');
  assert.equal(first.metadata.buyer_email, 'first@example.test');
  assert.equal(second.metadata.buyer_email, 'second@example.test');
  assert.equal(first.metadata.buyer_user_id, 'buyer-1');
  assert.equal(second.metadata.buyer_user_id, 'buyer-2');

  assert.equal(buyerEmailFromStripeSession({
    customer_details: { email: 'shared-billing@example.test' },
    customer_email: 'shared-customer@example.test',
    metadata: first.metadata,
  }), 'first@example.test');
  assert.equal(buyerEmailFromStripeSession({
    customer_details: { email: 'shared-billing@example.test' },
    metadata: second.metadata,
  }), 'second@example.test');
});

test('Session metadata binds the exact current shipping plan contract', () => {
  const params = buildStripeCheckoutSessionParams({
    ...base,
    email: 'buyer@example.test',
    shippingSelection: {
      v: 3,
      plan_id: 'plan-1',
      plan_digest: 'digest-1',
      address: { name: 'Buyer', address1: '100 Main', city: 'Melbourne', state: 'FL', postal_code: '32901', country: 'US' },
      billing_address: { name: 'Buyer', address1: '100 Main', city: 'Melbourne', state: 'FL', postal_code: '32901', country: 'US' },
      rate: { rate_id: 'rate-1', amount_minor: 2000, currency: 'usd' },
    },
  });
  assert.equal(params.metadata.shipping_contract_version, '3');
  assert.equal(params.metadata.shipping_plan_id, 'plan-1');
  assert.equal(params.metadata.shipping_plan_digest, 'digest-1');
});
