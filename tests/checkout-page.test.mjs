import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { addressMatches, checkoutAddress } from "../js/checkout.js";

test("checkout page owns business, shipping, billing, rate, and payment steps", () => {
  const html = fs.readFileSync(new URL("../checkout.html", import.meta.url), "utf8");
  for (const marker of [
    'id="businessName"',
    'id="shippingAddress1"',
    'id="billingSameAsShipping"',
    'id="billingAddressFields"',
    'id="shippingRates"',
    'id="checkoutPay"',
    'src="js/checkout.js',
  ]) assert.match(html, new RegExp(marker));
});

test("checkout address shape carries contact fields and normalizes domestic values", () => {
  const values = {
    contactName: " Omar Buyer ", businessName: " Acme HVAC ", phone: " 321-555-0100 ",
    shippingAddress1: " 100 Main St ", shippingAddress2: " Suite 2 ",
    shippingCity: " Melbourne ", shippingState: " fl ", shippingPostalCode: " 32901 ",
    shippingResidential: false,
  };
  assert.deepEqual(checkoutAddress(values, "shipping"), {
    name: "Omar Buyer", company: "Acme HVAC", phone: "321-555-0100",
    address1: "100 Main St", address2: "Suite 2", city: "Melbourne",
    state: "FL", postal_code: "32901", country: "US", residential: false,
  });
});

test("saved address matching ignores case and whitespace but not delivery fields", () => {
  const saved = { line1: "100 MAIN ST", line2: "Suite 2", city: "Melbourne", state: "FL", zip: "32901" };
  const current = { address1: " 100 main st ", address2: "suite 2", city: "melbourne", state: "fl", postal_code: "32901" };
  assert.equal(addressMatches(saved, current), true);
  assert.equal(addressMatches(saved, { ...current, postal_code: "32902" }), false);
});
