import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutShippingError } from "../functions/_lib/checkout-shipping.js";
import { createShippingRatesHandler } from "../functions/api/shipping-rates.js";

function request(body) {
  return new Request("https://masest.co/api/shipping-rates", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

test("shipping-rates endpoint loads only cart variants and returns public signed rates", async () => {
  const calls = [];
  const handler = createShippingRatesHandler({
    rateLimit: async () => ({ ok: true }),
    loadVariants: async (_env, skus) => {
      calls.push(skus);
      return [{ vsku: "VK-TRQ-1G" }];
    },
    quoteCheckoutRates: async (input) => {
      assert.deepEqual(input.cart, [{ sku: "VK-TRQ-1G", qty: 2 }]);
      assert.equal(input.variants[0].vsku, "VK-TRQ-1G");
      assert.equal(input.billing_same_as_shipping, false);
      assert.equal(input.billing_address.address1, "200 Billing Ave");
      return { package_count: 2, rates: [{
        carrier_name: "USPS", service_type: "Ground Advantage", amount_minor: 2450,
        currency: "usd", delivery_days: 5, token: "opaque.signed",
      }] };
    },
  });
  const response = await handler({
    request: request({
      cart: [{ sku: "VK-TRQ-1G", qty: 2 }],
      address: { postal_code: "32901" },
      billing_same_as_shipping: false,
      billing_address: { address1: "200 Billing Ave" },
      email: "buyer@example.com",
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["VK-TRQ-1G"]]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).rates[0].token, "opaque.signed");
});

test("shipping-rates endpoint maps bounded validation and provider failures", async () => {
  const make = (error) => createShippingRatesHandler({
    rateLimit: async () => ({ ok: true }),
    loadVariants: async () => [],
    quoteCheckoutRates: async () => { throw error; },
  });
  for (const [error, expected] of [
    [new CheckoutShippingError("shipping_address_incomplete", 400), 400],
    [new CheckoutShippingError("shipping_package_profile_missing", 409), 409],
    [new CheckoutShippingError("shipping_rates_unavailable", 502), 502],
  ]) {
    const response = await make(error)({
      request: request({ cart: [{ sku: "A", qty: 1 }], address: {} }),
      env: {},
    });
    assert.equal(response.status, expected);
    assert.deepEqual(await response.json(), { error: error.code });
  }
});
