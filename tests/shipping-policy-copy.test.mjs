import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FULFILLMENT_POLICY } from "../functions/_lib/fulfillment-schedule.js";
import { assertShippableAddress } from "../functions/_lib/checkout-shipping.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The promise buyers read and the schedule checkout computes must be the same promise.
// Checkout's own shipping note is generated from FULFILLMENT_POLICY; these static lines are
// not, so if the cutoff or handling time changes, this fails until the copy is rewritten.
function cutoffPhrase() {
  const hour = FULFILLMENT_POLICY.cutoffHourEt;
  return `${hour % 12 || 12} ${hour < 12 ? "am" : "pm"}`;
}

function handlingPhrase() {
  assert.equal(FULFILLMENT_POLICY.handlingDays, 1,
    "handling time changed: rewrite 'the next business day' in the policy copy, then this test");
  return "the next business day";
}

const purchaseLine = () => `Orders by ${cutoffPhrase()} ET ship ${handlingPhrase()}. Unopened returns within 30 days.`;

test("every purchase surface states the same shipping cutoff and returns window", () => {
  const line = purchaseLine();
  assert.ok(read("checkout.html").includes(line), "checkout.html");
  assert.ok(read("cart.html").includes(line), "cart.html");
  assert.ok(read("tools/seo-inject.mjs").includes(line), "product hero template");
  assert.ok(read("products/crhd.html").includes(line), "a generated buyable product page");
  assert.match(read("shipping-returns.html"),
    new RegExp(`Orders placed by ${cutoffPhrase()} Eastern on a business day ship ${handlingPhrase()}`));
});

test("every policy line links to the shipping and returns page, and that page is published", () => {
  for (const [path, href] of [["checkout.html", "shipping-returns"], ["cart.html", "shipping-returns"],
    ["products/crhd.html", "../shipping-returns"]]) {
    assert.ok(read(path).includes(`<a href="${href}">Shipping and returns</a>`), path);
  }
  assert.match(read("js/main/chrome.js"), /class="foot-legal"><a href="\$\{root\}shipping-returns">/);
  assert.match(read("terms.html"), /<a href="shipping-returns">shipping and returns<\/a>/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/masest\.co\/shipping-returns<\/loc>/);
  assert.match(read("shipping-returns.html"), /<link rel="canonical" href="https:\/\/masest\.co\/shipping-returns">/);
});

test("the policy page states the owner's terms, and the checkout gate enforces its delivery area", () => {
  const page = read("shipping-returns.html");
  for (const term of [
    "48 contiguous states and Washington, DC",
    "Alaska, Hawaii, U.S. territories, military (APO, FPO, and DPO) addresses, or PO boxes",
    "within 30 days of delivery",
    "we cannot accept opened containers",
    "You pay return shipping",
    "within 5 business days of receiving the return",
    "Original shipping charges are not refunded",
    "no restocking fee",
    "within 7 days of delivery with your order number and a photo",
    "before the order ships, and we will cancel it and refund you in full",
    "NET invoices of $2,500 or more are paid by ACH bank transfer",
    "mailto:sales@masest.co",
  ]) {
    assert.ok(page.includes(term), term);
  }

  const street = { address1: "100 Main St", address2: "", postal_code: "20001" };
  assert.doesNotThrow(() => assertShippableAddress({ ...street, state: "DC" }));
  for (const state of ["AK", "HI", "PR", "AE"]) {
    assert.throws(() => assertShippableAddress({ ...street, state }), /shipping_region_unsupported/);
  }
  assert.throws(() => assertShippableAddress({ ...street, state: "DC", address1: "PO Box 9" }),
    /shipping_po_box_unsupported/);
});

test("quote-only product pages point bulk buyers at NET terms instead of a parcel promise", () => {
  const template = read("tools/seo-inject.mjs");
  assert.ok(template.includes(
    'Quoted orders ship by freight, and approved businesses can pay on NET terms. <a href="../shipping-returns#payment">Payment terms</a>',
  ));
  assert.match(read("shipping-returns.html"), /<h2 id="payment">Payment and NET terms<\/h2>/);
});
