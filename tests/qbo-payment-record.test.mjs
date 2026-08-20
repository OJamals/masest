import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const STAFF_ORDER_OPERATIONS = read("functions/_lib/staff-order-operations.js");
const ADMIN_UI = read("js/admin/orders.js"); // Orders tab moved in #36

test("admin orders can record a QuickBooks payment id for NET orders", () => {
  assert.match(STAFF_ORDER_OPERATIONS, /body\.action\s*===\s*['"]record_qbo_payment['"]/);
  assert.match(STAFF_ORDER_OPERATIONS, /qbo_payment_id_required/);
  assert.match(STAFF_ORDER_OPERATIONS, /payment_method\s*!==\s*['"]net['"]/);
  assert.match(STAFF_ORDER_OPERATIONS, /qbo_payment_id:\s*paymentId/);
  assert.match(STAFF_ORDER_OPERATIONS, /status:\s*settledOrderStatus\(orderBefore\)/);
  assert.match(STAFF_ORDER_OPERATIONS, /payment received/);
  assert.match(STAFF_ORDER_OPERATIONS,
    /record_qbo_payment['"]\s*\)\s*\{[\s\S]{0,200}?staffCan\(role,\s*['"]company\.credit['"]\)/,
    "manual payment recording must require owner/finance via company.credit");
});

test("admin orders UI exposes a QuickBooks payment record action", () => {
  assert.match(ADMIN_UI, /data-qbo-payment-order/);
  assert.match(ADMIN_UI, /record_qbo_payment/);
  assert.match(ADMIN_UI, /QuickBooks payment ID/);
});
