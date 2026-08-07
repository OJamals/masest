import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SCHEMA = read("supabase/schema.sql");
const ORDER_INTEGRITY = read("supabase/schema-order-integrity.sql");
const CHECKOUT = read("functions/api/checkout.js");
const STRIPE_WEBHOOK = read("functions/api/stripe-webhook.js");
const ORDER_SHAPE = read("functions/_lib/order-shape.js");
const STRIPE_EFFECTS = read("functions/_lib/integration-effects.js");
const ACCOUNT_ORDERS = read("functions/api/account/orders.js");
const ADMIN_ORDERS = read("functions/api/admin/orders.js");
const DASHBOARD = read("js/dashboard.js");
const ADMIN_ORDER_UI = read("js/admin/orders.js");

test("orders persist buyer email for shipment notifications", () => {
  assert.match(SCHEMA, /customer_email\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists customer_email\s+text/i);
  assert.match(ORDER_INTEGRITY,
    /function\s+public\.place_net_order_v2[\s\S]*customer_email[\s\S]*p_email/i);
  // The Stripe paid-order row is built by order-shape.js; the webhook resolves the
  // buyer email and passes it into orderRowFromSession.
  assert.match(STRIPE_WEBHOOK, /orderRowFromSession\(s,\s*buyerEmailFromStripeSession\(s\)\)/);
  assert.match(ORDER_SHAPE, /customer_email:\s*customerEmail/);
});

test("shipping and purchase-order references reach confirmations and order views", () => {
  // Checkout is card/ACH only, so it carries the PO into the Stripe session rather than
  // rendering a confirmation itself — the paid-order email is built in integration-effects.
  assert.match(CHECKOUT, /purchaseOrderNumber,/);
  assert.match(STRIPE_EFFECTS, /Purchase order:/);
  assert.match(STRIPE_EFFECTS, />Shipping<\/td>/);
  assert.match(ACCOUNT_ORDERS, /currency,purchase_order_number,/);
  assert.match(ADMIN_ORDERS, /currency,purchase_order_number,/);
  assert.match(DASHBOARD, /Purchase order:/);
  assert.match(ADMIN_ORDER_UI, /Purchase order:/);
});

test("tracking updates email buyer + company recipients once, deduplicated", () => {
  assert.match(ADMIN_ORDERS, /function sendTrackingEmail/);
  assert.match(ADMIN_ORDERS, /function notifyBuyerTracking/);
  assert.match(ADMIN_ORDERS, /order\?\.customer_email/);
  // The recipient union is deduplicated inside sendTrackingEmail (Set over normalized emails).
  assert.match(ADMIN_ORDERS, /new Set\(\(recipients \|\| \[\]\)/);
  assert.match(ADMIN_ORDERS, /await sendTrackingEmail\(env,\s*request,\s*order,\s*notifyLabel,\s*notifyBody,\s*\[order\?\.customer_email,\s*\.\.\.companyRecipients\]\)/);
  assert.match(ADMIN_ORDERS, /htmlEscape/);
});

test("public order number is used across confirmation, tracking, dashboard, admin, and CSV", () => {
  assert.match(STRIPE_EFFECTS, /select\('id,order_number,status,/);
  assert.match(STRIPE_EFFECTS, /orderReference\(order\)/);
  assert.match(ACCOUNT_ORDERS, /select\('id,order_number,status,/);
  assert.match(ADMIN_ORDERS, /select\('id,order_number,status,/);
  assert.match(ADMIN_ORDERS, /const reference = orderReference\(order\)[\s\S]*subject:\s*`Order \$\{reference\} \$\{label\}`/);
  assert.match(ADMIN_ORDERS, /rows\.push\(\[o\.order_number \|\| o\.id,/);
  assert.match(DASHBOARD, /o\.order_number \|\| o\.id/);
  assert.match(ADMIN_ORDER_UI, /order\.order_number \|\| order\.id/);
});
