import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateCheckoutRates,
  quoteCheckoutRates,
} from "../functions/_lib/checkout-shipping.js";
import { createShippingEstimateHandler } from "../functions/api/shipping-estimate.js";

const ENV = {
  SHIPSTATION_API_KEY: "k".repeat(40),
  SHIPSTATION_WAREHOUSE_ID: "se-warehouse-1",
  SHIPPING_QUOTE_SECRET: "s".repeat(40),
};

const JUG = {
  vsku: "VK-CRHD-1G",
  product_sku: "cr-hd",
  label: "1 gal jug",
  price: 12.5,
  currency: "usd",
  active: true,
  shipping_weight_lb: 9.5,
  shipping_length_in: 12,
  shipping_width_in: 8,
  shipping_height_in: 10,
  products: { name: "VertKleen CR-HD", mode: "buy", active: true },
};

const WAREHOUSE = {
  warehouse_id: "se-warehouse-1",
  origin_address: { postal_code: "32952-7223", country_code: "US" },
};

// Shaped from a real api.shipstation.com /v2/rates/estimate response for a 28.5 lb,
// 24x12x10 carton. The flat-rate entries are the important part: the provider returns them
// regardless of the parcel it was asked to price.
function providerEstimatePayload() {
  return [
    { carrier_id: "se-1", carrier_friendly_name: "USPS", service_code: "usps_priority_mail", service_type: "USPS Priority Mail", package_type: "flat_rate_envelope", shipping_amount: { amount: 9.62, currency: "usd" }, delivery_days: 3 },
    { carrier_id: "se-1", carrier_friendly_name: "USPS", service_code: "usps_priority_mail", service_type: "USPS Priority Mail", package_type: "small_flat_rate_box", shipping_amount: { amount: 10.59, currency: "usd" }, delivery_days: 3 },
    { carrier_id: "se-1", carrier_friendly_name: "USPS", service_code: "usps_media_mail", service_type: "USPS Media Mail", package_type: "package", shipping_amount: { amount: 25.02, currency: "usd" }, delivery_days: 7 },
    { carrier_id: "se-2", carrier_friendly_name: "UPS", service_code: "ups_ground", service_type: "UPS® Ground", package_type: null, shipping_amount: { amount: 46.20, currency: "usd" }, delivery_days: 4 },
    { carrier_id: "se-3", carrier_friendly_name: "FedEx", service_code: "fedex_ground", service_type: "FedEx Ground®", package_type: null, shipping_amount: { amount: 50.90, currency: "usd" }, delivery_days: 5 },
  ];
}

function estimateDeps(overrides = {}) {
  return {
    now: () => Date.parse("2026-08-10T12:00:00Z"),
    listCarriers: async () => ({ carriers: [{ carrier_id: "se-1" }, { carrier_id: "se-2" }, { carrier_id: "se-3" }] }),
    loadWarehouse: async () => WAREHOUSE,
    estimateRates: async () => providerEstimatePayload(),
    ...overrides,
  };
}

// The defect this pins: MASEST always ships its own cartons (package_code 'package' is
// hardcoded for both rating and label purchase), but the provider prices carrier-supplied
// flat-rate packaging too. Sorting on price alone made a $9.62 flat-rate envelope the
// cheapest option for a 28.5 lb carton that cannot physically fit in one — a rate
// fulfillment can never buy, with the difference coming out of margin on every order.
test("estimate never offers a rate priced for carrier-supplied packaging", async () => {
  const result = await estimateCheckoutRates(
    { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 3 }], variants: [JUG], destination: { postal_code: "95112" } },
    estimateDeps(),
  );
  assert.equal(result.estimate, true);
  assert.equal(result.package_count, 1);
  assert.equal(result.postal_code, "95112");
  // $9.62 flat-rate envelope and $10.59 flat-rate box are both gone; media mail is filtered
  // by the existing service rule; UPS Ground (own packaging) is the honest cheapest.
  assert.equal(result.rates[0].amount_minor, 4620);
  assert.equal(result.rates[0].carrier_name, "UPS");
  assert.ok(result.rates.every((rate) => rate.amount_minor >= 4620));
  assert.ok(result.rates.every((rate) => !/media|library/i.test(rate.service_type)));
});

test("the bookable quote applies the same own-packaging rule as the estimate", async () => {
  const shared = { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 3 }], variants: [JUG] };
  const quote = await quoteCheckoutRates({
    ...shared,
    email: "buyer@example.com",
    address: {
      name: "Pat Buyer", phone: "8135550142", address1: "1 Washington Sq", address2: "",
      city: "San Jose", state: "CA", postal_code: "95112", country: "US", residential: false,
    },
    billing_same_as_shipping: true,
  }, {
    now: () => Date.parse("2026-08-10T12:00:00Z"),
    validateAddress: async (address) => ({ address, corrected: false }),
    listCarriers: async () => ({ carriers: [{ carrier_id: "se-1" }, { carrier_id: "se-2" }, { carrier_id: "se-3" }] }),
    // /rates answers { rate_response: { rates } } and, unlike /rates/estimate, carries rate_id.
    quoteRates: async () => ({
      rate_response: {
        rates: providerEstimatePayload().map((rate, index) => ({ ...rate, rate_id: `se-rate-${index}` })),
      },
    }),
    persistShippingQuotes: async () => ({ ok: true }),
  });
  const estimate = await estimateCheckoutRates({ ...shared, destination: { postal_code: "95112" } }, estimateDeps());
  assert.equal(quote.rates[0].amount_minor, 4620);
  // A buyer who estimated from the cart must not watch the price change for no reason at
  // checkout; the two paths read the same provider list through the same rules.
  assert.equal(quote.rates[0].amount_minor, estimate.rates[0].amount_minor);
  assert.ok(quote.rates[0].token, "bookable rates stay signed");
});

test("an estimate is never mistakable for a purchasable rate", async () => {
  const result = await estimateCheckoutRates(
    { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 1 }], variants: [JUG], destination: { postal_code: "95112" } },
    estimateDeps(),
  );
  for (const rate of result.rates) {
    assert.ok(!("rate_id" in rate), "estimates carry no provider rate id");
    assert.ok(!("token" in rate), "estimates carry no signed selection token");
  }
});

test("estimating writes no shipping quote row", async () => {
  let persisted = false;
  await estimateCheckoutRates(
    { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 1 }], variants: [JUG], destination: { postal_code: "95112" } },
    estimateDeps({ persistShippingQuotes: async () => { persisted = true; return { ok: true }; } }),
  );
  assert.equal(persisted, false, "an estimate must not reserve a carton plan");
});

// The provider's estimate endpoint prices one parcel. A cart that consolidates into several
// cartons would be understated by a single-parcel number, so it declines instead.
test("a multi-carton cart declines rather than understating a single parcel", async () => {
  await assert.rejects(
    () => estimateCheckoutRates(
      { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 6 }], variants: [JUG], destination: { postal_code: "95112" } },
      estimateDeps(),
    ),
    (error) => {
      assert.equal(error.code, "shipping_estimate_unavailable");
      assert.equal(error.status, 409);
      assert.equal(error.details.package_count, 2);
      return true;
    },
  );
});

// Bulk sizes are quote-routed by carrying active=false, and they also have no shipping
// dimensions. The packer would have caught them second and blamed the dimensions, reporting
// an LTL business rule as a data defect; the availability gate has to answer first.
test("a freight-only bulk size is refused as unavailable, not as missing dimensions", async () => {
  const drum = {
    vsku: "VK-CRHD-55G", product_sku: "cr-hd", label: "55 gal drum", price: 726.56,
    active: false, shipping_weight_lb: null, shipping_length_in: null,
    shipping_width_in: null, shipping_height_in: null,
    products: { name: "VertKleen CR-HD", mode: "buy", active: true },
  };
  await assert.rejects(
    () => estimateCheckoutRates(
      { env: ENV, cart: [{ sku: "VK-CRHD-55G", qty: 1 }], variants: [drum], destination: { postal_code: "95112" } },
      estimateDeps(),
    ),
    (error) => {
      assert.equal(error.code, "shipping_product_unavailable");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details.skus, ["VK-CRHD-55G"]);
      return true;
    },
  );
});

test("estimate rejects non-US and malformed postal codes", async () => {
  const base = { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 1 }], variants: [JUG] };
  await assert.rejects(
    () => estimateCheckoutRates({ ...base, destination: { postal_code: "9511" } }, estimateDeps()),
    (error) => error.code === "shipping_estimate_postal_invalid",
  );
  await assert.rejects(
    () => estimateCheckoutRates({ ...base, destination: { postal_code: "95112", country: "CA" } }, estimateDeps()),
    (error) => error.code === "shipping_domestic_only",
  );
});

test("estimate fails closed when the warehouse has no usable origin", async () => {
  await assert.rejects(
    () => estimateCheckoutRates(
      { env: ENV, cart: [{ sku: "VK-CRHD-1G", qty: 1 }], variants: [JUG], destination: { postal_code: "95112" } },
      estimateDeps({ loadWarehouse: async () => ({ origin_address: { postal_code: "", country_code: "US" } }) }),
    ),
    (error) => error.code === "shipping_estimate_origin_unavailable" && error.status === 503,
  );
});

test("shipping-estimate endpoint loads only cart variants and returns unsigned rates", async () => {
  const loaded = [];
  const handler = createShippingEstimateHandler({
    rateLimit: async () => ({ ok: true }),
    loadVariants: async (_env, skus) => { loaded.push(skus); return [JUG]; },
    estimateCheckoutRates: async (input) => {
      assert.deepEqual(input.cart, [{ sku: "VK-CRHD-1G", qty: 2 }]);
      assert.deepEqual(input.destination, { postal_code: "95112" });
      return { estimate: true, postal_code: "95112", package_count: 1, rates: [{ amount_minor: 4620 }] };
    },
  });
  const response = await handler({
    request: new Request("https://masest.co/api/shipping-estimate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
      body: JSON.stringify({ cart: [{ sku: "VK-CRHD-1G", qty: 2 }], destination: { postal_code: "95112" } }),
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(loaded, [["VK-CRHD-1G"]]);
  const body = await response.json();
  assert.equal(body.estimate, true);
  assert.ok(!JSON.stringify(body).includes("token"));
});

test("shipping-estimate endpoint surfaces its error codes and rate limit", async () => {
  const limited = createShippingEstimateHandler({ rateLimit: async () => ({ ok: false, retryAfter: 30 }) });
  const limitedResponse = await limited({
    request: new Request("https://masest.co/api/shipping-estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cart: [{ sku: "VK-CRHD-1G", qty: 1 }] }),
    }),
    env: {},
  });
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("Retry-After"), "30");

  const empty = createShippingEstimateHandler({ rateLimit: async () => ({ ok: true }) });
  const emptyResponse = await empty({
    request: new Request("https://masest.co/api/shipping-estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cart: [] }),
    }),
    env: {},
  });
  assert.equal(emptyResponse.status, 400);
  assert.equal((await emptyResponse.json()).error, "shipping_cart_invalid");
});
