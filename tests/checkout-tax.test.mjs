import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeCheckoutSessionParams,
  normalizePurchaseOrderNumber,
  parseStripeShippingRateIds,
  shippingRateIdsFromContentEntries,
} from "../functions/_lib/checkout-session.js";
import { assembleCartMetadata, parseCartMetadata } from "../functions/_lib/order-shape.js";

const base = {
  appUrl: "https://masest.co",
  sellable: [{ sku: "A", product_sku: "P", name: "A", price: 10, stripe_price_id: null }],
  qtyBySku: { A: 2 },
};

test("non-taxable product gets the non-taxable tax_code; taxable uses account default", () => {
  const exempt = buildStripeCheckoutSessionParams({
    ...base, email: "x@y.co",
    sellable: [{ sku: "A", name: "A", price: 10, stripe_price_id: null, taxable: false }],
  });
  assert.equal(exempt.line_items[0].price_data.product_data.tax_code, "txcd_00000000");
  const taxed = buildStripeCheckoutSessionParams({
    ...base, email: "x@y.co",
    sellable: [{ sku: "A", name: "A", price: 10, stripe_price_id: null, taxable: true }],
  });
  assert.equal(taxed.line_items[0].price_data.product_data.tax_code, undefined);
});

test("backordered flag rides along in the (chunked) cart metadata", () => {
  const p = buildStripeCheckoutSessionParams({
    ...base, email: "x@y.co",
    sellable: [{ sku: "A", name: "A", price: 10, stripe_price_id: null, backordered: true }],
  });
  assert.equal(parseCartMetadata(assembleCartMetadata(p.metadata))[0].backordered, true);
});

test("automatic_tax stays OFF by default, ON only when taxEnabled", () => {
  assert.equal(buildStripeCheckoutSessionParams({ ...base, email: "x@y.co" }).automatic_tax.enabled, false);
  assert.equal(buildStripeCheckoutSessionParams({ ...base, email: "x@y.co", taxEnabled: true }).automatic_tax.enabled, true);
});

test("configured Stripe shipping rates become checkout shipping options", () => {
  const p = buildStripeCheckoutSessionParams({
    ...base,
    email: "x@y.co",
    shippingRateIds: ["shr_ground", "shr_express"],
  });
  assert.deepEqual(p.shipping_options, [
    { shipping_rate: "shr_ground" },
    { shipping_rate: "shr_express" },
  ]);
});

test("a signed carrier quote becomes one inline Stripe rate and pre-collected ship metadata", () => {
  const p = buildStripeCheckoutSessionParams({
    ...base,
    email: "x@y.co",
    shippingSelection: {
      address: {
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
      },
      billing_address: {
        name: "Omar Buyer",
        company: "Acme HVAC",
        phone: "321-555-0100",
        address1: "200 Billing Ave",
        address2: "",
        city: "Melbourne",
        state: "FL",
        postal_code: "32902",
        country: "US",
        residential: false,
      },
      billing_same_as_shipping: false,
      rate: {
        rate_id: "se-rate-ground",
        carrier_id: "se-usps",
        carrier_name: "USPS",
        service_code: "usps_ground_advantage",
        service_type: "Ground Advantage",
        amount_minor: 2450,
        currency: "usd",
        delivery_days: 5,
      },
    },
  });
  assert.equal(p.shipping_address_collection, undefined);
  assert.deepEqual(p.shipping_options, [{
    shipping_rate_data: {
      // Stripe rejects a shipping rate with unspecified tax behavior once automatic_tax
      // is enabled, so the inline rate always declares it.
      tax_behavior: "exclusive",
      type: "fixed_amount",
      display_name: "USPS — Ground Advantage",
      fixed_amount: { amount: 2450, currency: "usd" },
      delivery_estimate: { maximum: { unit: "business_day", value: 5 } },
      metadata: {
        provider: "shipengine",
        provider_rate_id: "se-rate-ground",
        carrier_id: "se-usps",
        service_code: "usps_ground_advantage",
      },
    },
  }]);
  assert.equal(p.metadata.ship_address1, "100 Main St");
  assert.equal(p.metadata.ship_postal_code, "32901");
  assert.equal(p.metadata.bill_address1, "200 Billing Ave");
  assert.equal(p.metadata.billing_same_as_shipping, "no");
  assert.equal(p.billing_address_collection, "auto");
  assert.equal(p.metadata.shipping_rate_id, "se-rate-ground");
  assert.equal(p.cancel_url, "https://masest.co/checkout.html");
});

test("shipping-rate config trims and deduplicates valid Stripe IDs, rejects invalid config", () => {
  assert.deepEqual(
    parseStripeShippingRateIds(" shr_ground,shr_express,shr_ground "),
    ["shr_ground", "shr_express"],
  );
  assert.deepEqual(parseStripeShippingRateIds(""), []);
  assert.equal(parseStripeShippingRateIds("shr_ground,price_not_shipping"), null);
  assert.equal(parseStripeShippingRateIds("shr_1,shr_2,shr_3,shr_4,shr_5,shr_6"), null);
});

test("published CMS shipping rates filter inactive entries and sort deterministically", () => {
  assert.deepEqual(shippingRateIdsFromContentEntries([
    { slug: "express", payload: { stripe_rate_id: "shr_express", active: true, sort_order: 20 } },
    { slug: "disabled", payload: { stripe_rate_id: "not_a_rate", active: false, sort_order: 1 } },
    { slug: "ground", payload: { stripe_rate_id: "shr_ground", active: true, sort_order: 10 } },
    { slug: "duplicate", payload: { stripe_rate_id: "shr_ground", active: true, sort_order: 30 } },
  ]), ["shr_ground", "shr_express"]);
  assert.deepEqual(shippingRateIdsFromContentEntries([]), []);
  assert.equal(shippingRateIdsFromContentEntries([
    { slug: "bad", payload: { stripe_rate_id: "price_not_shipping", active: true } },
  ]), null);
});

test("purchase-order metadata uses a normalized optional reference", () => {
  assert.deepEqual(normalizePurchaseOrderNumber(" PO-77 "), { value: "PO-77" });
  assert.deepEqual(normalizePurchaseOrderNumber(""), { value: null });
  assert.deepEqual(normalizePurchaseOrderNumber(undefined), { value: null });
  for (const value of [123, "P".repeat(65), "PO-1\nInjected"]) {
    assert.deepEqual(normalizePurchaseOrderNumber(value), { error: "invalid_purchase_order_number" });
  }
  const p = buildStripeCheckoutSessionParams({
    ...base,
    email: "x@y.co",
    purchaseOrderNumber: "PO-77",
  });
  assert.equal(p.metadata.purchase_order_number, "PO-77");
});

test("guest checkout uses customer_email, no customer binding", () => {
  const p = buildStripeCheckoutSessionParams({ ...base, email: "x@y.co" });
  assert.equal(p.customer_email, "x@y.co");
  assert.equal(p.customer, undefined);
  assert.equal(p.customer_update, undefined);
});

test("B2B checkout binds the Customer (carries tax exemption), drops customer_email", () => {
  const p = buildStripeCheckoutSessionParams({ ...base, email: "x@y.co", customerId: "cus_1" });
  assert.equal(p.customer, "cus_1");
  assert.equal(p.customer_email, undefined); // Stripe forbids both
  assert.deepEqual(p.customer_update, { address: "auto", shipping: "auto", name: "auto" });
});
