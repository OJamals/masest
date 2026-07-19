import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SCHEMA = read("supabase/schema.sql");
const ORDER_INTEGRITY = read("supabase/schema-order-integrity.sql");
const CHECKOUT = read("functions/api/checkout.js");
const STRIPE_WEBHOOK = read("functions/api/stripe-webhook.js");
const ORDER_SHAPE = read("functions/_lib/order-shape.js");
const ADMIN_ORDERS = read("functions/api/admin/orders.js");

test("orders persist buyer email for shipment notifications", () => {
  assert.match(SCHEMA, /customer_email\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists customer_email\s+text/i);
  assert.match(CHECKOUT, /p_email:\s*user\.email\s*\|\|\s*null/);
  assert.match(ORDER_INTEGRITY,
    /function\s+public\.place_net_order_v2[\s\S]*customer_email[\s\S]*p_email/i);
  // The Stripe paid-order row is built by order-shape.js; the webhook resolves the
  // buyer email and passes it into orderRowFromSession.
  assert.match(STRIPE_WEBHOOK, /orderRowFromSession\(s,\s*buyerEmailFromStripeSession\(s\)\)/);
  assert.match(ORDER_SHAPE, /customer_email:\s*customerEmail/);
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
