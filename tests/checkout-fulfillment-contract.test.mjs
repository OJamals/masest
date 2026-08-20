import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutFulfillmentStripeTransport,
  hydrateCheckoutFulfillmentOrder,
  issueCheckoutFulfillmentContracts,
  resolveCheckoutFulfillmentSelection,
} from '../functions/_lib/checkout-fulfillment-contract.js';

const env = { SHIPPING_QUOTE_SECRET: 'q'.repeat(48) };
const cart = [{ sku: 'VK-1', qty: 2 }];
const address = {
  name: 'Buyer One', company: 'Acme', phone: '321-555-0100',
  address1: '100 Main St', address2: '', city: 'Melbourne', state: 'FL',
  postal_code: '32901', country: 'US', residential: false,
};
const packages = [{
  package_code: 'package',
  weight: { value: 20, unit: 'pound' },
  dimensions: { unit: 'inch', length: 6, width: 6, height: 12 },
}];
const rate = {
  rate_id: 'rate-1', carrier_id: 'carrier-1', carrier_name: 'Carrier',
  service_code: 'ground', service_type: 'Ground', amount_minor: 2000,
  currency: 'usd', delivery_days: 3,
};

test('one fulfillment contract owns quote issue, Stripe transport, and paid Order hydration', async () => {
  let storedPlans;
  const issued = await issueCheckoutFulfillmentContracts({
    env,
    cart,
    address,
    billingAddress: address,
    billingSameAsShipping: true,
    packages,
    rates: [rate],
    expiresAt: '2023-11-14T22:28:20.000Z',
  }, {
    persistShippingQuotes: async (_env, plans) => {
      storedPlans = structuredClone(plans);
      return { ok: true, count: plans.length };
    },
  });

  const loadShippingQuotePlan = async (_env, planId) => ({
    outcome: 'found',
    plan: structuredClone(storedPlans.find((plan) => plan.plan_id === planId)),
  });
  const selection = await resolveCheckoutFulfillmentSelection({
    env,
    token: issued.rates[0].token,
    cart,
    sb: {},
    now: () => 1_700_000_100_000,
  }, { loadShippingQuotePlan });
  const transport = checkoutFulfillmentStripeTransport(selection);
  const order = await hydrateCheckoutFulfillmentOrder({
    env,
    session: {
      metadata: transport.metadata,
      shipping_cost: { amount_subtotal: 2000 },
    },
    cart,
    order: { id: 'order-1' },
    sb: {},
  }, { loadShippingQuotePlan });

  assert.equal(storedPlans.length, 1);
  assert.equal(selection.plan_id, 'rate-1');
  assert.equal(transport.shippingOption.shipping_rate_data.fixed_amount.amount, 2000);
  assert.equal(transport.metadata.shipping_plan_digest, storedPlans[0].plan_digest);
  assert.deepEqual(order.shipping_package_plan, packages);
  assert.equal(order.ship_address.address.line1, address.address1);
  assert.equal(order.fulfillment_contract_status, 'bound');
  assert.equal(order.shipstation_error, null);
});
