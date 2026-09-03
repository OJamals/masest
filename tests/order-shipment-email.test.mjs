import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SCHEMA = read("supabase/schema.sql");
const ORDER_INTEGRITY = read("supabase/schema-order-integrity.sql");
const CHECKOUT = read("functions/api/checkout.js");
const STRIPE_WEBHOOK = read("functions/api/stripe-webhook.js");
const CHECKOUT_FULFILLMENT = read("functions/_lib/checkout-fulfillment-contract.js");
const ORDER_SHAPE = read("functions/_lib/order-shape.js");
const STRIPE_EFFECTS = read("functions/_lib/integration-effects.js");
const EMAIL_RENDERERS = read("functions/_lib/email-renderers.js");
const ACCOUNT_ORDERS = read("functions/api/account/orders.js");
const ADMIN_ORDERS = read("functions/api/admin/orders.js");
const STAFF_ORDER_OPERATIONS = read("functions/_lib/staff-order-operations.js");
const DASHBOARD = read("js/dashboard.js");
const ADMIN_ORDER_UI = read("js/admin/orders.js");

test("orders persist buyer email for shipment notifications", () => {
  assert.match(SCHEMA, /customer_email\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists customer_email\s+text/i);
  assert.match(ORDER_INTEGRITY,
    /function\s+public\.place_net_order_v2[\s\S]*customer_email[\s\S]*p_email/i);
  // The Stripe paid-order row is built by order-shape.js; the webhook resolves the
  // bound current-version Buyer email and passes it into orderRowFromSession.
  assert.match(STRIPE_WEBHOOK, /const buyerEmail = checkoutFulfillmentBuyerEmail\(/);
  assert.match(CHECKOUT_FULFILLMENT, /checkoutFulfillmentNeedsBoundBuyer\(session\)[\s\S]*\? boundBuyerEmail[\s\S]*: legacyBuyerEmail/);
  assert.match(STRIPE_WEBHOOK, /orderRowFromSession\(s,\s*buyerEmail\)/);
  assert.match(ORDER_SHAPE, /customer_email:\s*customerEmail/);
});

test("shipping and purchase-order references reach confirmations and order views", () => {
  // Checkout is card/ACH only, so it carries the PO into the Stripe session rather than
  // rendering a confirmation itself — the paid-order email is built in integration-effects.
  assert.match(CHECKOUT, /purchaseOrderNumber,/);
  assert.match(STRIPE_EFFECTS, /shipping_address:\s*addressOf\(order\)/);
  assert.match(EMAIL_RENDERERS, /order\.purchase_order_number/);
  assert.match(EMAIL_RENDERERS, /\['Shipping', order\.shipping\]/);
  assert.match(ACCOUNT_ORDERS, /currency,purchase_order_number,/);
  assert.match(ADMIN_ORDERS, /currency,purchase_order_number,/);
  assert.match(DASHBOARD, /Purchase order:/);
  assert.match(ADMIN_ORDER_UI, /Purchase order:/);
});

test("tracking updates email buyer + company recipients once, deduplicated", () => {
  assert.match(STAFF_ORDER_OPERATIONS, /function sendTrackingEmail/);
  assert.match(STAFF_ORDER_OPERATIONS, /function notifyBuyerTracking/);
  assert.match(STAFF_ORDER_OPERATIONS, /order\?\.customer_email/);
  // The recipient union is deduplicated inside sendTrackingEmail (Set over normalized emails).
  assert.match(STAFF_ORDER_OPERATIONS, /new Set\(\(recipients \|\| \[\]\)/);
  assert.match(STAFF_ORDER_OPERATIONS, /await sendOrderTrackingEmail\([\s\S]{0,180}\[order\?\.customer_email,\s*\.\.\.companyRecipients\]/);
  assert.match(STAFF_ORDER_OPERATIONS, /renderCommerceEmail\(/);
  assert.match(EMAIL_RENDERERS, /emailEscape\(config\.summary\)/);
});

test("public order number is used across confirmation, tracking, dashboard, admin, and CSV", () => {
  assert.match(STRIPE_EFFECTS, /select\('[^']*\border_number\b[^']*'\)/);
  assert.match(STRIPE_EFFECTS, /orderReference\(order\)/);
  assert.match(ACCOUNT_ORDERS, /select\('id,order_number,status,/);
  assert.match(ADMIN_ORDERS, /select\('id,order_number,status,/);
  assert.match(STAFF_ORDER_OPERATIONS, /const reference = orderReference\(order\)[\s\S]*renderCommerceEmail\(/);
  assert.match(EMAIL_RENDERERS, /subject:\s*`Order \$\{reference\}/);
  assert.match(ADMIN_ORDERS, /rows\.push\(\[o\.order_number \|\| o\.id,/);
  assert.match(DASHBOARD, /o\.order_number \|\| o\.id/);
  assert.match(ADMIN_ORDER_UI, /order\.order_number \|\| order\.id/);
});
