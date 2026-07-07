import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const SCHEMA = read("../supabase/schema.sql");
const ADMIN_ORDERS = read("../functions/api/admin/orders.js");
const ACCOUNT_ORDERS = read("../functions/api/account/orders.js");
const ACCOUNT_ORDER = read("../functions/api/account/order.js");
const ADMIN_JS = read("../js/admin/orders.js"); // Orders tab moved in #36
const DASHBOARD_JS = read("../js/dashboard.js");

test("orders schema stores customer-visible shipment tracking fields", () => {
  assert.match(SCHEMA, /alter table public\.orders add column if not exists tracking_status\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists carrier\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists tracking_number\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists tracking_url\s+text/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists estimated_delivery_at\s+timestamptz/i);
  assert.match(SCHEMA, /alter table public\.orders add column if not exists shipped_at\s+timestamptz/i);
  assert.match(SCHEMA, /orders_tracking_status_idx/i);
});

test("account order endpoints expose tracking fields to buyers", () => {
  for (const src of [ACCOUNT_ORDERS, ACCOUNT_ORDER]) {
    assert.match(src, /tracking_status/);
    assert.match(src, /carrier/);
    assert.match(src, /tracking_number/);
    assert.match(src, /tracking_url/);
    assert.match(src, /estimated_delivery_at/);
    assert.match(src, /shipped_at/);
  }
});

test("staff orders API can update tracking metadata and notify buyers", () => {
  assert.match(ADMIN_ORDERS, /'Tracking status'/);
  assert.match(ADMIN_ORDERS, /'Carrier'/);
  assert.match(ADMIN_ORDERS, /'Tracking #'/);
  assert.match(ADMIN_ORDERS, /'ETA'/);
  assert.match(ADMIN_ORDERS, /action\s*===\s*['"]update_tracking['"]/);
  assert.match(ADMIN_ORDERS, /body\.tracking_status/);
  assert.match(ADMIN_ORDERS, /tracking_number/);
  assert.match(ADMIN_ORDERS, /tracking_url/);
  assert.match(ADMIN_ORDERS, /estimated_delivery_at/);
  // Delivered closes the loop with its own label/body; shipped and generic updates keep theirs.
  assert.match(ADMIN_ORDERS, /const notifyLabel\s*=\s*delivered\s*\?\s*['"]delivered['"]\s*:\s*shipped\s*\?\s*['"]shipped['"]\s*:\s*['"]tracking updated['"]/);
  assert.match(ADMIN_ORDERS, /Your order was delivered\./);
  // One rich tracking email goes to buyer + company recipients (sendTrackingEmail), so
  // the clickable tracking link is never shadowed by the generic notifyCompany email.
  assert.match(ADMIN_ORDERS, /await sendTrackingEmail\(env,\s*request,\s*order,\s*notifyLabel,\s*notifyBody,\s*\[order\?\.customer_email,\s*\.\.\.companyRecipients\]\)/);
});

test("staff shipment tracking with a carrier tracking number marks orders fulfilled", () => {
  assert.match(ADMIN_ORDERS, /const update\s*=\s*\{\s*tracking_status:\s*trackingStatus/);
  // Promotion is gated on settled payment: a shipped NET order must stay net_open so it
  // keeps counting against the company's outstanding credit until it's actually paid.
  assert.match(ADMIN_ORDERS, /const fulfilled\s*=\s*\['shipped',\s*'delivered'\]\.includes\(trackingStatus\)\s*&&\s*trackingNumber\s*&&\s*\['paid',\s*'net_paid'\]\.includes\(current\.status\)/);
  assert.match(
    ADMIN_ORDERS,
    /if\s*\(fulfilled\)\s*\{\s*update\.status\s*=\s*'fulfilled';\s*\}/
  );
});

test("staff console surfaces tracking controls on each order", () => {
  assert.match(ADMIN_JS, /data-track-status/);
  assert.match(ADMIN_JS, /data-track-carrier/);
  assert.match(ADMIN_JS, /data-track-number/);
  assert.match(ADMIN_JS, /data-track-url/);
  assert.match(ADMIN_JS, /data-track-eta/);
  assert.match(ADMIN_JS, /action:\s*['"]update_tracking['"]/);
});

test("buyer dashboard renders an order tracking timeline", () => {
  assert.match(DASHBOARD_JS, /function trackingSteps/);
  assert.match(DASHBOARD_JS, /class="trackline"/);
  assert.match(DASHBOARD_JS, /tracking_url/);
  assert.match(DASHBOARD_JS, /tracking_number/);
  assert.match(DASHBOARD_JS, /estimated_delivery_at/);
});
