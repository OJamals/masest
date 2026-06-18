import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QBO schema defines token/cache tables and order sync columns", () => {
  const sql = read("docs/supabase/qbo-sync.sql");
  for (const table of ["qbo_tokens", "qbo_items", "qbo_customers"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), `${table} must be provisioned`);
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${table} to service_role`), `${table} must be service-role writable`);
  }
  assert.match(sql, /create type qbo_sync_status as enum \('pending','processing','synced','error','skipped'\)/);
  for (const column of ["qbo_sync_status", "qbo_doc_id", "qbo_doc_type", "qbo_synced_at", "qbo_error", "qbo_attempts", "qbo_next_attempt_at"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), `${column} must be added to orders`);
  }
  assert.match(sql, /orders_qbo_pending_idx/);
});

test("new NET and Stripe orders enter the QBO sync queue", () => {
  const checkout = read("functions/api/checkout.js");
  const webhook = read("functions/api/stripe-webhook.js");

  assert.match(checkout, /payment_method:\s*'net'[\s\S]*qbo_sync_status:\s*'pending'/,
    "NET checkout orders should start pending QBO invoice sync");
  assert.match(webhook, /payment_method:\s*'stripe'[\s\S]*qbo_sync_status:\s*'pending'/,
    "Stripe checkout orders should start pending QBO sales receipt sync");
});
