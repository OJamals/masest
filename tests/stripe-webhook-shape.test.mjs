import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToAmount,
  stripeQboSyncStatus,
  assembleCartMetadata,
  parseCartMetadata,
  orderRowFromSession,
  cartLines,
  orderItemRows,
  stockDecrements,
  stockIncrements,
  isSubscriptionCheckout,
  subscriptionRow,
  qboSubscriptionInvoiceRow,
} from "../functions/_lib/order-shape.js";
import { cartMetadataEntries } from "../functions/_lib/checkout-session.js";

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

test("parseCartMetadata parses + normalizes both cart shapes, else returns []", () => {
  // Legacy full shape (single-key metadata written before the 500-char chunk fix).
  assert.deepEqual(parseCartMetadata('[{"sku":"A","name":"Prod A","qty":2,"unit_price":9.5}]'), [
    { sku: "A", product_sku: null, name: "Prod A", qty: 2, unit_price: 9.5, backordered: false },
  ]);
  // Compact chunked shape ({s,ps,q,p,b}) — no names (webhook enriches from DB).
  assert.deepEqual(parseCartMetadata('[{"s":"A","ps":"a","q":2,"p":9.5,"b":1}]'), [
    { sku: "A", product_sku: "a", name: null, qty: 2, unit_price: 9.5, backordered: true },
  ]);
  assert.deepEqual(parseCartMetadata(""), []);
  assert.deepEqual(parseCartMetadata(undefined), []);
  assert.deepEqual(parseCartMetadata("{not json"), []);
  assert.deepEqual(parseCartMetadata('{"a":1}'), []); // non-array JSON -> []
});

test("assembleCartMetadata rejoins chunked cart keys in order; legacy single key passes through", () => {
  assert.equal(assembleCartMetadata({ cart: '[{"s":"A"' , cart2: ',"q":1}]' }), '[{"s":"A","q":1}]');
  assert.equal(assembleCartMetadata({ cart: '[{"sku":"A"}]' }), '[{"sku":"A"}]');
  assert.equal(assembleCartMetadata({}), "");
  assert.equal(assembleCartMetadata(undefined), "");
});

test("cartMetadataEntries round-trips through assemble+parse and every chunk fits Stripe's 500-char cap", () => {
  // A cart big enough to overflow one metadata value (the bug this pins: Stripe
  // rejects any metadata value >500 chars, which used to kill multi-item checkouts).
  const cart = Array.from({ length: 30 }, (_, i) => ({
    sku: `VK-SKU-${i}-5GAL`, product_sku: `vk-${i}`, name: `VertKleen Product ${i} - 5 gallon pail`,
    qty: i + 1, unit_price: 19.75 + i, backordered: i % 7 === 0,
  }));
  const entries = cartMetadataEntries(cart);
  assert.ok(Object.keys(entries).length > 1, "expected a multi-chunk cart");
  assert.ok(Object.keys(entries).length <= 17, "cart chunks must leave room for fixed Session metadata");
  for (const [k, v] of Object.entries(entries)) assert.ok(v.length <= 500, `${k} exceeds 500 chars`);
  const parsed = parseCartMetadata(assembleCartMetadata(entries));
  assert.equal(parsed.length, cart.length);
  parsed.forEach((line, i) => {
    assert.equal(line.sku, cart[i].sku);
    assert.equal(line.product_sku, cart[i].product_sku);
    assert.equal(line.qty, cart[i].qty);
    assert.equal(line.unit_price, cart[i].unit_price);
    assert.equal(line.backordered, cart[i].backordered);
    assert.equal(line.name, null); // names are re-derived from the DB by the webhook
  });
});

test("orderRowFromSession mirrors the paid-order insert incl. qbo + customer_email", () => {
  const session = {
    metadata: { company_id: "co-9", purchase_order_number: "PO-1042" },
    amount_subtotal: 10000,
    shipping_cost: { amount_subtotal: 1500 },
    total_details: { amount_tax: 725, amount_shipping: 1500 },
    amount_total: 12225,
    currency: "usd",
    payment_intent: "pi_123",
    collected_information: { shipping_details: { address: { line1: "1 A St" } } },
  };
  assert.deepEqual(orderRowFromSession(session, "buyer@x.com"), {
    company_id: "co-9",
    user_id: null,
    status: "paid",
    payment_method: "stripe",
    qbo_sync_status: "pending",
    subtotal: 100,
    shipping: 15,
    tax: 7.25,
    total: 122.25,
    currency: "usd",
    stripe_payment_intent: "pi_123",
    customer_email: "buyer@x.com",
    purchase_order_number: "PO-1042",
    ship_address: { address: { line1: "1 A St" } },
    // What the buyer selected at checkout, so fulfilment can buy the service that was
    // paid for instead of re-shopping rates blind.
    paid_shipping_rate_id: null,
    paid_shipping_carrier_id: null,
    paid_shipping_service_code: null,
  });
});

test("orderRowFromSession carries the selected carrier service off session metadata", () => {
  const row = orderRowFromSession({
    payment_intent: "pi_5",
    metadata: {
      shipping_rate_id: "se-rate-ground",
      shipping_carrier_id: "se-usps",
      shipping_service_code: "usps_ground_advantage",
    },
  });
  assert.equal(row.paid_shipping_rate_id, "se-rate-ground");
  assert.equal(row.paid_shipping_carrier_id, "se-usps");
  assert.equal(row.paid_shipping_service_code, "usps_ground_advantage");
});

test("orderRowFromSession: unsettled ACH session -> pending_payment with QBO sync held", () => {
  const row = orderRowFromSession({ payment_status: "unpaid", payment_intent: "pi_9" });
  assert.equal(row.status, "pending_payment");
  assert.equal(row.qbo_sync_status, null); // out of the claim queue until the debit clears
  assert.equal(orderRowFromSession({ payment_status: "paid" }).status, "paid");
  assert.equal(orderRowFromSession({}).status, "paid"); // absent payment_status = settled (card)
});

// Events reach the webhook in the account's default API version (the endpoint pins none),
// a dahlia version. Basil moved or removed several fields these shapes read.
test("qboSubscriptionInvoiceRow reads a basil-or-later invoice: parent subscription, total_taxes", () => {
  const row = qboSubscriptionInvoiceRow({
    id: "in_new",
    livemode: true,
    total: 10700,
    total_taxes: [{ amount: 500 }, { amount: 200 }],
    customer: "cus_1",
    parent: { type: "subscription_details", subscription_details: { subscription: { id: "sub_7" } } },
    lines: { data: [{ description: "VertKleen Gold program" }] },
  }, { companyId: "co-1", tier: "Gold" });
  assert.equal(row.stripe_subscription_id, "sub_7");
  assert.equal(row.tax, 7);
  assert.equal(row.subtotal, 100);
  assert.equal(row.total, 107);
  // payments is expandable only, so an event payload never names the PaymentIntent;
  // subscriptionOrderForQbo falls back to the invoice id for the QBO payment reference.
  assert.equal(row.stripe_payment_intent, null);
});

test("qboSubscriptionInvoiceRow takes the PaymentIntent from expanded invoice payments when present", () => {
  const row = qboSubscriptionInvoiceRow({
    id: "in_expanded",
    total: 4900,
    payments: { data: [
      { status: "canceled", payment: { type: "payment_intent", payment_intent: "pi_old" } },
      { status: "paid", payment: { type: "payment_intent", payment_intent: { id: "pi_paid" } } },
    ] },
  });
  assert.equal(row.stripe_payment_intent, "pi_paid");
});

test("qboSubscriptionInvoiceRow no longer reads pre-basil invoice fields", () => {
  // Every invoice arrives in a basil-or-later version, so these fields cannot appear; reading
  // them would only hide a payload in an unexpected version.
  const row = qboSubscriptionInvoiceRow({
    id: "in_old",
    total: 10700,
    total_tax_amounts: [{ amount: 700 }],
    subscription: "sub_old",
    payment_intent: "pi_old",
  });
  assert.equal(row.stripe_subscription_id, null);
  assert.equal(row.stripe_payment_intent, null);
  assert.equal(row.tax, 0);
});

test("orderRowFromSession reads shipping collected by Stripe from collected_information", () => {
  const row = orderRowFromSession({
    payment_status: "paid",
    collected_information: { shipping_details: { name: "Pat", address: { line1: "9 B St" } } },
    customer_details: { address: { city: "Tampa" } },
  });
  assert.deepEqual(row.ship_address, { name: "Pat", address: { line1: "9 B St" } });
  // The pre-basil top-level shipping_details is no longer read.
  const old = orderRowFromSession({
    payment_status: "paid",
    shipping_details: { name: "Old", address: { line1: "1 Old Rd" } },
    customer_details: { address: { city: "Tampa" } },
  });
  assert.deepEqual(old.ship_address, { address: { city: "Tampa" } });
});

test("Stripe test-mode orders and subscription invoices never enter production QBO queues", () => {
  assert.equal(stripeQboSyncStatus(false), "skipped");
  assert.equal(stripeQboSyncStatus(true), "pending");
  assert.equal(
    orderRowFromSession({ payment_status: "paid", livemode: false }).qbo_sync_status,
    "skipped",
  );
  assert.equal(
    orderRowFromSession({ payment_status: "paid", livemode: true }).qbo_sync_status,
    "pending",
  );
  assert.equal(
    qboSubscriptionInvoiceRow(
      { id: "in_test", total: 1000, livemode: false },
      { companyId: "co-1", tier: "Silver" },
    ).qbo_sync_status,
    "skipped",
  );
});

test("stockIncrements mirrors decrements: skuless AND backordered lines are skipped", () => {
  assert.deepEqual(
    stockIncrements([{ sku: "A", qty: 2 }, { sku: "", qty: 9 }, { sku: "C", qty: 5, backordered: true }]),
    [{ p_vsku: "A", p_qty: 2 }],
  );
});

test("orderRowFromSession falls back: customer_details ship address, usd currency, null company/email", () => {
  const row = orderRowFromSession({ customer_details: { address: { city: "Tampa" } } });
  assert.equal(row.company_id, null);
  assert.equal(row.currency, "usd");
  assert.equal(row.customer_email, null);
  assert.equal(row.purchase_order_number, null);
  assert.deepEqual(row.ship_address, { address: { city: "Tampa" } });
  assert.equal(row.subtotal, 0);
  assert.equal(row.shipping, 0);
  assert.equal(row.total, 0);
});

test("orderRowFromSession rebuilds a pre-collected checkout shipping address from signed metadata", () => {
  const row = orderRowFromSession({
    payment_status: "paid",
    metadata: {
      ship_name: "Omar Buyer",
      ship_company: "Acme HVAC",
      ship_phone: "321-555-0100",
      ship_address1: "100 Main St",
      ship_address2: "Suite 2",
      ship_city: "Melbourne",
      ship_state: "FL",
      ship_postal_code: "32901",
      ship_country: "US",
      ship_residential: "no",
    },
  });
  assert.deepEqual(row.ship_address, {
    name: "Omar Buyer",
    company: "Acme HVAC",
    phone: "321-555-0100",
    address: {
      line1: "100 Main St",
      line2: "Suite 2",
      city: "Melbourne",
      state: "FL",
      postal_code: "32901",
      country: "US",
    },
    residential: false,
  });
});

test("cartLines normalizes raw cart entries to order lines", () => {
  assert.deepEqual(
    cartLines([{ sku: "VK-1", product_sku: "vk", name: "VK 1gal", qty: 2, unit_price: 9.5 }, { sku: "VK-2", qty: 1, unit_price: 4 }]),
    [
      { sku: "VK-1", product_sku: "vk", name: "VK 1gal", qty: 2, unit_price: 9.5, backordered: false },
      { sku: "VK-2", product_sku: null, name: "VK-2", qty: 1, unit_price: 4, backordered: false },
    ],
  );
});

test("cartLines carries the backordered flag through", () => {
  assert.deepEqual(
    cartLines([{ sku: "A", qty: 1, unit_price: 5, backordered: true }]),
    [{ sku: "A", product_sku: null, name: "A", qty: 1, unit_price: 5, backordered: true }],
  );
});

test("orderItemRows attaches order id and raw line_total (unit_price*qty)", () => {
  assert.deepEqual(orderItemRows([{ sku: "A", product_sku: null, name: "A", qty: 3, unit_price: 2 }], "ord-1"), [
    { order_id: "ord-1", sku: "A", product_sku: null, name: "A", qty: 3, unit_price: 2, line_total: 6, backordered: false },
  ]);
  assert.equal(orderItemRows([{ sku: "A", qty: 1, unit_price: 2, backordered: true }], "o")[0].backordered, true);
});

test("stockDecrements skips skuless AND backordered lines", () => {
  assert.deepEqual(
    stockDecrements([{ sku: "A", qty: 2 }, { sku: "", qty: 9 }, { qty: 1 }, { sku: "B" }, { sku: "C", qty: 5, backordered: true }]),
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

test("qboSubscriptionInvoiceRow queues paid Stripe program invoices exactly once", () => {
  assert.deepEqual(qboSubscriptionInvoiceRow({
    id: "in_123",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_123" } },
    customer: "cus_123",
    payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_123" } }] },
    customer_email: "billing@example.test",
    currency: "usd",
    total: 10900,
    total_taxes: [{ amount: 900 }],
    lines: { data: [{ description: "VertKleen Gold program" }] },
  }, { companyId: "co-1", tier: "Gold" }), {
    company_id: "co-1",
    stripe_invoice_id: "in_123",
    stripe_subscription_id: "sub_123",
    stripe_customer_id: "cus_123",
    stripe_payment_intent: "pi_123",
    customer_email: "billing@example.test",
    tier: "Gold",
    description: "VertKleen Gold program",
    subtotal: 100,
    tax: 9,
    total: 109,
    currency: "usd",
    qbo_sync_status: "pending",
  });
});

test("qboSubscriptionInvoiceRow records zero-dollar program invoices as skipped", () => {
  const row = qboSubscriptionInvoiceRow({ id: "in_zero", total: 0 }, { companyId: "co-1", tier: "Silver" });
  assert.equal(row.total, 0);
  assert.equal(row.qbo_sync_status, "skipped");
});
