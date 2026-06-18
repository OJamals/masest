import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin orders can record a QuickBooks invoice id for NET orders", () => {
  const source = read("functions/api/admin/orders.js");
  assert.match(source, /qbo_invoice_id/, "orders API must read and write the QBO invoice id field");
  assert.match(source, /body\.action\s*===\s*['"]record_qbo_invoice['"]/,
    "orders API must expose a record_qbo_invoice admin action");
  assert.match(source, /payment_method\s*!==\s*['"]net['"]/,
    "QBO invoice recording must be limited to NET orders");
  assert.match(source, /qbo_invoice_id_required/,
    "orders API must reject a missing QBO invoice id");
  assert.match(source, /update\(\{\s*qbo_invoice_id:/,
    "orders API must persist the QBO invoice id on the order");
});

test("admin orders UI exposes the QuickBooks invoice action", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /data-qbo-order/,
    "admin order rows must expose a QuickBooks invoice action");
  assert.match(admin, /QuickBooks invoice ID/,
    "admin action should prompt staff for the invoice id to record");
});
