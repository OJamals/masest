import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin orders API exposes QuickBooks sync document and payment ids", () => {
  const source = read("functions/api/admin/orders.js");

  assert.match(source, /qbo_doc_id/, "orders API must expose the synced QBO document id");
  assert.match(source, /qbo_doc_type/, "orders API must expose the synced QBO document type");
  assert.match(source, /qbo_payment_id/, "orders API must expose the linked QBO payment id");
  assert.match(source, /QBO doc/,
    "orders CSV export should include QBO document columns for accounting reconciliation");
  assert.match(source, /QBO payment/,
    "orders CSV export should include the linked QBO payment id");
});

test("admin orders UI renders QuickBooks sync ids for reconciliation", () => {
  const admin = read("js/admin/orders.js"); // Orders tab moved in #36

  assert.match(admin, /qboReconciliation\(order\)/,
    "orders table should render a reusable QuickBooks reconciliation summary");
  assert.match(admin, /order\.qbo_payment_id/,
    "admin order rows should show linked QBO payment ids");
});
