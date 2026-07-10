import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SQL = readFileSync(new URL("../supabase/schema-order-integrity.sql", import.meta.url), "utf8");

test("persist_stripe_order writes the header and item snapshots in one transaction", () => {
  assert.match(SQL, /create\s+or\s+replace\s+function\s+public\.persist_stripe_order\s*\(/i);
  assert.match(SQL, /insert\s+into\s+public\.orders\s*\(/i);
  assert.match(SQL, /insert\s+into\s+public\.order_items\s*\(/i);
  assert.match(SQL, /jsonb_to_recordset\s*\(/i,
    "line-item JSON must be expanded within the database transaction");
});

test("persist_stripe_order is service-role only", () => {
  assert.match(SQL, /revoke\s+all\s+on\s+function\s+public\.persist_stripe_order\(jsonb,\s*jsonb\)\s+from\s+public/i);
  assert.match(SQL, /grant\s+execute\s+on\s+function\s+public\.persist_stripe_order\(jsonb,\s*jsonb\)\s+to\s+service_role/i);
});
