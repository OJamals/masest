import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ADMIN_ORDERS = read("functions/api/admin/orders.js");
const ADMIN_UI = read("js/admin/orders.js"); // Orders tab moved in #36

test("admin orders can record a QuickBooks payment id for NET orders", () => {
  assert.match(ADMIN_ORDERS, /body\.action\s*===\s*['"]record_qbo_payment['"]/);
  assert.match(ADMIN_ORDERS, /qbo_payment_id_required/);
  assert.match(ADMIN_ORDERS, /payment_method\s*!==\s*['"]net['"]/);
  assert.match(ADMIN_ORDERS, /qbo_payment_id:\s*paymentId/);
  assert.match(ADMIN_ORDERS, /status:\s*['"]net_paid['"]/);
  assert.match(ADMIN_ORDERS, /payment received/);
  assert.match(ADMIN_ORDERS,
    /record_qbo_payment['"]\s*\)\s*\{[\s\S]{0,200}?staffCan\(role,\s*['"]company\.credit['"]\)/,
    "manual payment recording must require owner/finance via company.credit");
});

test("admin orders UI exposes a QuickBooks payment record action", () => {
  assert.match(ADMIN_UI, /data-qbo-payment-order/);
  assert.match(ADMIN_UI, /record_qbo_payment/);
  assert.match(ADMIN_UI, /QuickBooks payment ID/);
});
