import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToAmount,
  parseCartMetadata,
  orderRowFromSession,
  cartLines,
  orderItemRows,
  stockDecrements,
  isSubscriptionCheckout,
  subscriptionRow,
} from "../functions/_lib/order-shape.js";

// Pins the persistence shapes extracted from the Stripe webhook
// (functions/api/stripe-webhook.js). Must mirror the inline handler exactly,
// including the paid order's qbo_sync_status='pending' and customer_email
// fields, the cents→dollars conversion, and the ship-address fallback chain.

test("centsToAmount converts integer minor units, null/undefined -> 0", () => {
  assert.equal(centsToAmount(12345), 123.45);
  assert.equal(centsToAmount(0), 0);
  assert.equal(centsToAmount(null), 0);
  assert.equal(centsToAmount(undefined), 0);
});

test("parseCartMetadata parses an array, else returns []", () => {
  assert.deepEqual(parseCartMetadata('[{"sku":"A"}]'), [{ sku: "A" }]);
  assert.deepEqual(parseCartMetadata(""), []);
  assert.deepEqual(parseCartMetadata(undefined), []);
  assert.deepEqual(parseCartMetadata("{not json"), []);
  assert.deepEqual(parseCartMetadata('{"a":1}'), []); // non-array JSON -> []
});

test("orderRowFromSession mirrors the paid-order insert incl. qbo + customer_email", () => {
  const session = {
    metadata: { company_id: "co-9" },
    amount_subtotal: 10000,
    total_details: { amount_tax: 725 },
    amount_total: 10725,
    currency: "usd",
    payment_intent: "pi_123",
    shipping_details: { address: { line1: "1 A St" } },
  };
  assert.deepEqual(orderRowFromSession(session, "buyer@x.com"), {
    company_id: "co-9",
    status: "paid",
    payment_method: "stripe",
    qbo_sync_status: "pending",
    subtotal: 100,
    tax: 7.25,
    total: 107.25,
    currency: "usd",
    stripe_payment_intent: "pi_123",
    customer_email: "buyer@x.com",
    ship_address: { address: { line1: "1 A St" } },
  });
});

test("orderRowFromSession falls back: customer_details ship address, usd currency, null company/email", () => {
  const row = orderRowFromSession({ customer_details: { address: { city: "Tampa" } } });
  assert.equal(row.company_id, null);
  assert.equal(row.currency, "usd");
  assert.equal(row.customer_email, null);
  assert.deepEqual(row.ship_address, { address: { city: "Tampa" } });
  assert.equal(row.subtotal, 0);
  assert.equal(row.total, 0);
});

test("cartLines normalizes raw cart entries to order lines", () => {
  assert.deepEqual(
    cartLines([{ sku: "VK-1", product_sku: "vk", name: "VK 1gal", qty: 2, unit_price: 9.5 }, { sku: "VK-2", qty: 1, unit_price: 4 }]),
    [
      { sku: "VK-1", product_sku: "vk", name: "VK 1gal", qty: 2, unit_price: 9.5 },
      { sku: "VK-2", product_sku: null, name: "VK-2", qty: 1, unit_price: 4 },
    ],
  );
});

test("orderItemRows attaches order id and raw line_total (unit_price*qty)", () => {
  assert.deepEqual(orderItemRows([{ sku: "A", product_sku: null, name: "A", qty: 3, unit_price: 2 }], "ord-1"), [
    { order_id: "ord-1", sku: "A", product_sku: null, name: "A", qty: 3, unit_price: 2, line_total: 6 },
  ]);
});

test("stockDecrements skips skuless lines and maps rpc args", () => {
  assert.deepEqual(
    stockDecrements([{ sku: "A", qty: 2 }, { sku: "", qty: 9 }, { qty: 1 }, { sku: "B" }]),
    [{ p_vsku: "A", p_qty: 2 }, { p_vsku: "B", p_qty: 0 }],
  );
});

test("isSubscriptionCheckout detects subscription mode", () => {
  assert.equal(isSubscriptionCheckout({ mode: "subscription" }), true);
  assert.equal(isSubscriptionCheckout({ mode: "payment" }), false);
  assert.equal(isSubscriptionCheckout(undefined), false);
});

test("subscriptionRow mirrors the program_subscriptions upsert", () => {
  assert.deepEqual(
    subscriptionRow({ metadata: { company_id: "co-1", tier: "Silver" }, subscription: "sub_1", customer: "cus_1" }),
    { company_id: "co-1", tier: "Silver", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" },
  );
  assert.deepEqual(subscriptionRow({}), {
    company_id: null, tier: null, stripe_subscription_id: null, stripe_customer_id: null, status: "active",
  });
});
