import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const SCHEMA = read("../supabase/schema.sql");
const ADMIN_ORDERS = read("../functions/api/admin/orders.js");
const STAFF_ORDER_OPERATIONS = read("../functions/_lib/staff-order-operations.js");
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
  assert.match(STAFF_ORDER_OPERATIONS, /action\s*===\s*['"]update_tracking['"]/);
  assert.match(STAFF_ORDER_OPERATIONS, /body\.tracking_status/);
  assert.match(STAFF_ORDER_OPERATIONS, /tracking_number/);
  assert.match(STAFF_ORDER_OPERATIONS, /tracking_url/);
  assert.match(STAFF_ORDER_OPERATIONS, /estimated_delivery_at/);
  // Delivered closes the loop with its own label/body; shipped and generic updates keep
  // theirs. The copy lives in the shared builder so an automatic carrier scan and a manual
  // staff update cannot word the same event differently.
  assert.match(STAFF_ORDER_OPERATIONS, /const notice\s*=\s*shipmentNotice\(noticeStatus,\s*\{ carrier, trackingNumber \}\)/);
  assert.match(STAFF_ORDER_OPERATIONS, /trackingStatus === 'delivered'[\s\S]{0,80}\|\| \(trackingStatus === 'shipped' && trackingNumber\)/);
  const ORDER_EMAIL = readFileSync(new URL('../functions/_lib/order-email.js', import.meta.url), 'utf8');
  assert.match(ORDER_EMAIL, /Your order was delivered\./);
  assert.match(ORDER_EMAIL, /Your order has shipped\./);
  // One rich tracking email goes to buyer + company recipients (sendTrackingEmail), so
  // the clickable tracking link is never shadowed by the generic notifyCompany email.
  assert.match(STAFF_ORDER_OPERATIONS, /await sendOrderTrackingEmail\([\s\S]{0,180}\[order\?\.customer_email, \.\.\.companyRecipients\]/);
});

test("staff shipment tracking promotes settled orders while preserving open NET receivables", () => {
  assert.match(STAFF_ORDER_OPERATIONS, /const update\s*=\s*\{\s*tracking_status:\s*trackingStatus/);
  // Promotion is centralized in the lifecycle helper: shipped requires tracking,
  // delivered can close settled local/BOL workflows without a parcel number, and
  // open NET receivables stay net_open until payment is recorded.
  assert.match(STAFF_ORDER_OPERATIONS, /const fulfilled\s*=\s*shouldPromoteToFulfilled\(current,\s*trackingStatus,\s*trackingNumber\)/);
  assert.match(
    STAFF_ORDER_OPERATIONS,
    /if\s*\(fulfilled\)\s*update\.status\s*=\s*'fulfilled'/
  );
  assert.match(STAFF_ORDER_OPERATIONS, /rpc\('update_order_tracking_guarded'/);
});

test("staff console surfaces tracking controls on each order", () => {
  assert.match(ADMIN_JS, /data-track-status/);
  assert.match(ADMIN_JS, /data-track-carrier/);
  assert.match(ADMIN_JS, /data-track-number/);
  assert.match(ADMIN_JS, /data-track-url/);
  assert.match(ADMIN_JS, /data-track-eta/);
  assert.match(ADMIN_JS, /data-track-status="\$\{id\}"[^>]+aria-label="Tracking status for order \$\{id\}"/);
  assert.match(ADMIN_JS, /data-track-carrier="\$\{id\}"[^>]+aria-label="Carrier for order \$\{id\}"/);
  assert.match(ADMIN_JS, /data-track-number="\$\{id\}"[^>]+aria-label="Tracking number for order \$\{id\}"/);
  assert.match(ADMIN_JS, /data-track-url="\$\{id\}"[^>]+aria-label="Tracking URL for order \$\{id\}"/);
  assert.match(ADMIN_JS, /action:\s*['"]update_tracking['"]/);
});

test("buyer dashboard renders an order tracking timeline", () => {
  assert.match(DASHBOARD_JS, /function trackingSteps/);
  assert.match(DASHBOARD_JS, /class="trackline"/);
  assert.match(DASHBOARD_JS, /tracking_url/);
  assert.match(DASHBOARD_JS, /tracking_number/);
  assert.match(DASHBOARD_JS, /estimated_delivery_at/);
});
