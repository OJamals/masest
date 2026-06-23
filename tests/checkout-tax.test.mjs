import assert from "node:assert/strict";
import test from "node:test";
import { buildStripeCheckoutSessionParams } from "../functions/_lib/checkout-session.js";

const base = {
  appUrl: "https://masest.co",
  sellable: [{ sku: "A", product_sku: "P", name: "A", price: 10, stripe_price_id: null }],
  qtyBySku: { A: 2 },
};

test("automatic_tax stays OFF by default, ON only when taxEnabled", () => {
  assert.equal(buildStripeCheckoutSessionParams({ ...base, email: "x@y.co" }).automatic_tax.enabled, false);
  assert.equal(buildStripeCheckoutSessionParams({ ...base, email: "x@y.co", taxEnabled: true }).automatic_tax.enabled, true);
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
