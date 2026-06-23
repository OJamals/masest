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
  assert.match(source, /qbo_sync_status:\s*['"]synced['"]/,
    "manual invoice recording should mark QBO sync complete");
  assert.match(source, /qbo_doc_type:\s*['"]invoice['"]/,
    "manual invoice recording should mark the linked QBO document as an invoice");
  assert.match(source,
    /record_qbo_invoice['"]\s*\)\s*\{[\s\S]{0,200}?staffCan\(role,\s*['"]company\.credit['"]\)/,
    "manual invoice recording must require owner/finance via company.credit");
});

test("admin orders UI exposes the QuickBooks invoice action", () => {
  const admin = read("js/admin/orders.js"); // Orders tab moved in #36
  assert.match(admin, /data-qbo-order/,
    "admin order rows must expose a QuickBooks invoice action");
  assert.match(admin, /QuickBooks invoice ID/,
    "admin action should prompt staff for the invoice id to record");
});
