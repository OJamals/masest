import assert from "node:assert/strict";
import test from "node:test";
import {
  CheckoutFulfillmentError,
  verifyShippingSelectionToken,
} from "../functions/_lib/checkout-fulfillment-contract.js";
import {
  assertShippableAddress,
  combinePackagesForRates,
  normalizeShippingAddress,
  quoteCheckoutRates,
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
    (error) => error instanceof CheckoutFulfillmentError && error.code === "shipping_address_incomplete",
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

test("a street the carrier cannot find is a 422, not a gateway failure", async () => {
  // Reproduced against production: Google's validator verdicts "123 Main St, Brooklyn NY
  // 11201" as ACCEPT and returns it without a ZIP+4, then ShipStation answers the rate
  // call with 400 "Address not found". That escaped as a bare ShipStationError, missed
  // the CheckoutFulfillmentError branch in /api/shipping-rates, and reached the buyer as
  // a 502 reading "no shipping option is available for this address and cart".
  const carrierRejection = Object.assign(new Error("shipstation_http_400"), {
    name: "ShipStationError",
    code: "shipstation_http_400",
    status: 400,
    detail: "Address not found",
  });

  await assert.rejects(
    quoteCheckoutRates({
      env: {
        SHIPSTATION_API_KEY: "se_test",
        SHIPSTATION_WAREHOUSE_ID: "se-2287981",
        SHIPPING_QUOTE_SECRET: "q".repeat(48),
      },
      cart: [{ sku: "VK-TRQ-1G", qty: 1 }],
      address,
      billing_same_as_shipping: true,
      billing_address: null,
      email: "buyer@example.com",
      variants,
    }, {
      now: () => 1_700_000_000_000,
      validateAddress,
      persistShippingQuotes,
      async listCarriers() {
        return { carriers: [{ carrier_id: "se-usps", friendly_name: "USPS" }] };
      },
      async quoteRates() {
        throw carrierRejection;
      },
    }),
    (error) => error instanceof CheckoutFulfillmentError
      && error.code === "shipping_address_unverified"
      && error.status === 422,
  );
});

test("a carrier 400 that is not about the address still fails as a gateway error", async () => {
  // Only address rejections get the buyer-facing 422. Anything else keeps reaching
  // /api/shipping-rates as an unmapped provider failure, which is what 502 is for.
  const providerRejection = Object.assign(new Error("shipstation_http_400"), {
    name: "ShipStationError",
    code: "shipstation_http_400",
    status: 400,
    detail: "Requested service is not available for this account",
  });

  await assert.rejects(
    quoteCheckoutRates({
      env: {
        SHIPSTATION_API_KEY: "se_test",
        SHIPSTATION_WAREHOUSE_ID: "se-2287981",
        SHIPPING_QUOTE_SECRET: "q".repeat(48),
      },
      cart: [{ sku: "VK-TRQ-1G", qty: 1 }],
      address,
      billing_same_as_shipping: true,
      billing_address: null,
      email: "buyer@example.com",
      variants,
    }, {
      now: () => 1_700_000_000_000,
      validateAddress,
      persistShippingQuotes,
      async listCarriers() {
        return { carriers: [{ carrier_id: "se-usps", friendly_name: "USPS" }] };
      },
      async quoteRates() {
        throw providerRejection;
      },
    }),
    (error) => !(error instanceof CheckoutFulfillmentError) && error.code === "shipstation_http_400",
  );
});

// Online orders ship by ground parcel from Florida to street addresses in the 48 contiguous
// states and DC. Everything else (Alaska, Hawaii, territories, military mail, PO boxes) is
// a quote. The published shipping policy says exactly this, so the gate has to hold for the
// typed address, for the address Google hands back, and never for the billing address.
const regionEnv = {
  SHIPSTATION_API_KEY: "se_test",
  SHIPSTATION_WAREHOUSE_ID: "se-2287981",
  SHIPPING_QUOTE_SECRET: "q".repeat(48),
};
const pastTheGate = Object.assign(new Error("reached_carrier"), { code: "reached_carrier" });

function regionQuote(input, dependencies = {}) {
  const calls = { validate: 0 };
  const promise = quoteCheckoutRates({
    env: regionEnv,
    cart: [{ sku: "VK-TRQ-1G", qty: 1 }],
    billing_same_as_shipping: true,
    billing_address: null,
    email: "buyer@example.com",
    variants,
    ...input,
  }, {
    now: () => 1_700_000_000_000,
    async validateAddress(value, env) {
      calls.validate += 1;
      return (dependencies.validateAddress || validateAddress)(value, env);
    },
    persistShippingQuotes,
    async listCarriers() {
      return { carriers: [{ carrier_id: "se-ups", friendly_name: "UPS" }] };
    },
    async quoteRates() {
      throw pastTheGate;
    },
  });
  return { promise, calls };
}

test("online checkout ships only to street addresses in the contiguous states and DC", async () => {
  for (const [state, postal_code] of [["AK", "99501"], ["HI", "96813"], ["PR", "00901"], ["VI", "00802"],
    ["GU", "96910"], ["AS", "96799"], ["MP", "96950"], ["AE", "09012"], ["AA", "34001"], ["AP", "96601"]]) {
    const { promise, calls } = regionQuote({ address: { ...address, state, postal_code } });
    await assert.rejects(
      promise,
      (error) => error instanceof CheckoutFulfillmentError
        && error.code === "shipping_region_unsupported"
        && error.status === 422,
      `${state} must be refused`,
    );
    assert.equal(calls.validate, 0, `${state} is refused before the paid address lookup`);
  }

  for (const [state, postal_code] of [["FL", "32901"], ["DC", "20001"], ["CA", "95112"], ["ME", "04101"]]) {
    const { promise } = regionQuote({ address: { ...address, state, postal_code } });
    await assert.rejects(promise, (error) => error?.code === "reached_carrier", `${state} must reach the carrier`);
  }
});

test("a state and ZIP that disagree cannot smuggle an excluded destination through", () => {
  // The typed state is not trusted on its own: a Honolulu ZIP under "FL" is still Hawaii.
  for (const postal_code of ["96813", "99501", "00901", "09012", "96910"]) {
    assert.throws(
      () => assertShippableAddress({ ...address, state: "FL", postal_code }),
      (error) => error.code === "shipping_region_unsupported",
      postal_code,
    );
  }
  // Nor is the ZIP: an excluded state is refused even when its ZIP looks contiguous.
  for (const state of ["AK", "HI", "PR", "GU", "AE", "AP", "ZZ"]) {
    assert.throws(
      () => assertShippableAddress({ ...address, state, postal_code: "32901" }),
      (error) => error.code === "shipping_region_unsupported",
      state,
    );
  }
});

test("PO boxes are refused on either address line, and look-alikes are not", async () => {
  for (const line of ["PO Box 12", "P.O. Box 12", "p o box 12", "POB 12", "P.O.B. 12",
    "Post Office Box 4", "Box 99", "po box #7"]) {
    for (const field of ["address1", "address2"]) {
      const { promise, calls } = regionQuote({ address: { ...address, [field]: line } });
      await assert.rejects(
        promise,
        (error) => error instanceof CheckoutFulfillmentError
          && error.code === "shipping_po_box_unsupported"
          && error.status === 422,
        `${field}: ${line}`,
      );
      assert.equal(calls.validate, 0);
    }
  }
  for (const line of ["12 Boxwood Ln", "PMB 204, 400 Main St", "1 Pobox Rd", "Box Elder Rd", "Suite 2"]) {
    const { promise } = regionQuote({ address: { ...address, address1: line, address2: "" } });
    await assert.rejects(promise, (error) => error?.code === "reached_carrier", line);
  }
});

test("the address Google corrects to is gated too, and the billing address never is", async () => {
  const movedToAlaska = async (value) => ({
    ...(await validateAddress(value)),
    address: { ...value, city: "Anchorage", state: "AK", postal_code: "99501" },
  });
  const corrected = regionQuote({ address }, { validateAddress: movedToAlaska });
  await assert.rejects(corrected.promise, (error) => error.code === "shipping_region_unsupported");

  const hawaiiBilling = regionQuote({
    address,
    billing_same_as_shipping: false,
    billing_address: { ...address, address1: "PO Box 5", city: "Honolulu", state: "HI", postal_code: "96813" },
  });
  await assert.rejects(hawaiiBilling.promise, (error) => error?.code === "reached_carrier");
});
