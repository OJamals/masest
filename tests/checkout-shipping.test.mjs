import assert from "node:assert/strict";
import test from "node:test";
import {
  CheckoutShippingError,
  combinePackagesForRates,
  normalizeShippingAddress,
  quoteCheckoutRates,
  verifyShippingSelectionToken,
} from "../functions/_lib/checkout-shipping.js";

const address = {
  name: "Omar Buyer",
  company: "Acme HVAC",
  phone: "321-555-0100",
  address1: "100 Main St",
  address2: "Suite 2",
  city: "Melbourne",
  state: "FL",
  postal_code: "32901",
  country: "US",
  residential: false,
};

const variants = [{
  vsku: "VK-TRQ-1G",
  product_sku: "VK-TRQ",
  label: "1 gal jug",
  price: 11.44,
  currency: "usd",
  active: true,
  shipping_weight_lb: 10,
  shipping_length_in: 6,
  shipping_width_in: 6,
  shipping_height_in: 12,
  products: { name: "VertKleen Torque", mode: "buy", active: true },
}];

const validateAddress = async (value) => ({
  address: value,
  corrected: false,
  formatted_address: "100 Main St, Melbourne, FL 32901, USA",
  possible_next_action: "ACCEPT",
});
const persistShippingQuotes = async (_env, rows) => ({ ok: true, count: rows.length });

test("shipping address normalizes a complete domestic delivery address", () => {
  assert.deepEqual(normalizeShippingAddress({ ...address, state: "fl", country: "us" }), {
    ...address,
    state: "FL",
    country: "US",
  });
  assert.throws(
    () => normalizeShippingAddress({ ...address, postal_code: "" }),
    (error) => error instanceof CheckoutShippingError && error.code === "shipping_address_incomplete",
  );
});

test("package combiner totals mixed-item weight and packs cartons under 50 lb", () => {
  const oneGallon = {
    package_code: "package",
    weight: { value: 10, unit: "pound" },
    dimensions: { length: 6, width: 6, height: 12, unit: "inch" },
  };
  const fiveGallon = {
    package_code: "package",
    weight: { value: 48, unit: "pound" },
    dimensions: { length: 12, width: 12, height: 16, unit: "inch" },
  };

  assert.deepEqual(combinePackagesForRates([oneGallon, oneGallon]), [{
    package_code: "package",
    weight: { value: 20, unit: "pound" },
    dimensions: { length: 12, width: 6, height: 12, unit: "inch" },
  }]);

  const mixed = combinePackagesForRates([fiveGallon, oneGallon, oneGallon]);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed.map((pkg) => pkg.weight.value), [48, 20]);
});

test("live rates use variant package profiles, sort by cost, and issue cart-bound tokens", async () => {
  let providerPayload;
  const result = await quoteCheckoutRates({
    env: {
      SHIPSTATION_API_KEY: "se_test",
      SHIPSTATION_WAREHOUSE_ID: "se-2287981",
      SHIPPING_QUOTE_SECRET: "q".repeat(48),
    },
    cart: [{ sku: "VK-TRQ-1G", qty: 2 }],
    address,
    billing_same_as_shipping: false,
    billing_address: { ...address, address1: "200 Billing Ave", address2: "" },
    email: "buyer@example.com",
    variants,
  }, {
    now: () => 1_700_000_000_000,
    validateAddress,
    persistShippingQuotes,
    async listCarriers() {
      return { carriers: [{ carrier_id: "se-usps", friendly_name: "USPS" }] };
    },
    async quoteRates(_env, payload) {
      providerPayload = payload;
      return {
        rate_response: {
          rates: [
            {
              rate_id: "se-rate-media",
              carrier_id: "se-usps",
              carrier_friendly_name: "USPS",
              service_code: "usps_media_mail",
              service_type: "USPS Media Mail",
              shipping_amount: { amount: 18.39, currency: "usd" },
              delivery_days: 7,
            },
            {
              rate_id: "se-rate-priority",
              carrier_id: "se-usps",
              carrier_friendly_name: "USPS",
              service_code: "usps_priority_mail",
              service_type: "Priority Mail",
              shipping_amount: { amount: 31.25, currency: "usd" },
              delivery_days: 3,
            },
            {
              rate_id: "se-rate-ground",
              carrier_id: "se-usps",
              carrier_friendly_name: "USPS",
              service_code: "usps_ground_advantage",
              service_type: "Ground Advantage",
              shipping_amount: { amount: 24.5, currency: "usd" },
              delivery_days: 5,
            },
            {
              rate_id: "se-rate-ground-duplicate",
              carrier_id: "se-usps",
              carrier_friendly_name: "USPS",
              service_code: "usps_ground_advantage",
              service_type: "Ground Advantage",
              shipping_amount: { amount: 24.5, currency: "usd" },
              delivery_days: 5,
            },
          ],
        },
      };
    },
  });

  assert.equal(providerPayload.shipment.packages.length, 1);
  assert.deepEqual(providerPayload.shipment.packages[0], {
    package_code: "package",
    weight: { value: 20, unit: "pound" },
    dimensions: { length: 12, width: 6, height: 12, unit: "inch" },
  });
  assert.equal(providerPayload.shipment.ship_to.postal_code, "32901");
  assert.equal(providerPayload.shipment.items[0].unit_price, 11.44);
  assert.deepEqual(result.rates.map((rate) => rate.amount_minor), [2450, 3125]);
  assert.equal(result.rates.some((rate) => /media|library/i.test(rate.service_type)), false);
  assert.equal(result.rates[0].token.includes("se-rate-ground"), false);

  const selection = await verifyShippingSelectionToken({
    secret: "q".repeat(48),
    token: result.rates[0].token,
    cart: [{ sku: "VK-TRQ-1G", qty: 2 }],
    now: () => 1_700_000_100_000,
  });
  assert.equal(selection.rate.rate_id, "se-rate-ground");
  assert.equal(selection.rate.amount_minor, 2450);
  assert.equal(selection.address.address1, "100 Main St");
  assert.equal(selection.billing_address.address1, "200 Billing Ave");
  assert.equal(selection.billing_same_as_shipping, false);

  await assert.rejects(
    () => verifyShippingSelectionToken({
      secret: "q".repeat(48),
      token: result.rates[0].token,
      cart: [{ sku: "VK-TRQ-1G", qty: 1 }],
      now: () => 1_700_000_100_000,
    }),
    (error) => error.code === "shipping_quote_cart_changed",
  );
});

test("checkout consolidates quantities above the provider's raw-package limit before rating", async () => {
  let ratedPackages;
  const result = await quoteCheckoutRates({
    env: {
      SHIPSTATION_API_KEY: "se_test",
      SHIPSTATION_WAREHOUSE_ID: "se-2287981",
      SHIPPING_QUOTE_SECRET: "q".repeat(48),
    },
    cart: [{ sku: "VK-TRQ-1G", qty: 21 }],
    address,
    variants,
  }, {
    validateAddress,
    persistShippingQuotes,
    async listCarriers() { return { carriers: [{ carrier_id: "se-usps" }] }; },
    async quoteRates(_env, payload) {
      ratedPackages = payload.shipment.packages;
      return { rate_response: { rates: [{
        rate_id: "se-rate-ground",
        carrier_id: "se-usps",
        carrier_friendly_name: "USPS",
        service_code: "ground",
        service_type: "Ground",
        shipping_amount: { amount: 100, currency: "usd" },
      }] } };
    },
  });

  assert.equal(result.package_count, 5);
  assert.deepEqual(ratedPackages.map((pkg) => pkg.weight.value), [50, 50, 50, 50, 10]);
});

test("shipping selection tokens reject tampering and expiry", async () => {
  const result = await quoteCheckoutRates({
    env: {
      SHIPSTATION_API_KEY: "se_test",
      SHIPSTATION_WAREHOUSE_ID: "se-2287981",
      SHIPPING_QUOTE_SECRET: "q".repeat(48),
    },
    cart: [{ sku: "VK-TRQ-1G", qty: 1 }],
    address,
    variants,
  }, {
    now: () => 1_700_000_000_000,
    validateAddress,
    persistShippingQuotes,
    async listCarriers() { return { carriers: [{ carrier_id: "se-usps" }] }; },
    async quoteRates() {
      return { rate_response: { rates: [{
        rate_id: "se-rate-ground",
        carrier_id: "se-usps",
        carrier_friendly_name: "USPS",
        service_code: "ground",
        service_type: "Ground",
        shipping_amount: { amount: 20, currency: "usd" },
      }] } };
    },
  });
  const token = result.rates[0].token;
  await assert.rejects(
    () => verifyShippingSelectionToken({
      secret: "q".repeat(48), token: `${token.slice(0, -1)}x`,
      cart: [{ sku: "VK-TRQ-1G", qty: 1 }], now: () => 1_700_000_100_000,
    }),
    (error) => error.code === "shipping_quote_invalid",
  );
  await assert.rejects(
    () => verifyShippingSelectionToken({
      secret: "q".repeat(48), token,
      cart: [{ sku: "VK-TRQ-1G", qty: 1 }], now: () => 1_700_001_000_000,
    }),
    (error) => error.code === "shipping_quote_expired",
  );
});
