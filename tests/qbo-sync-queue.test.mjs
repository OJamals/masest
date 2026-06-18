import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QBO schema defines token/cache tables and order sync columns", () => {
  const sql = read("supabase/schema-qbo.sql");
  for (const table of ["qbo_tokens", "qbo_items", "qbo_customers"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), `${table} must be provisioned`);
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${table} to service_role`), `${table} must be service-role writable`);
  }
  assert.match(sql, /create type qbo_sync_status as enum \('pending','processing','synced','error','skipped'\)/);
  for (const column of ["qbo_sync_status", "qbo_doc_id", "qbo_doc_type", "qbo_synced_at", "qbo_error", "qbo_attempts", "qbo_next_attempt_at"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), `${column} must be added to orders`);
  }
  assert.match(sql, /orders_qbo_pending_idx/);
  assert.match(sql, /create or replace function public\.claim_qbo_orders\(batch int\)/,
    "schema must provide an atomic claim RPC for the sync worker");
  assert.match(sql, /for update skip locked/,
    "claim RPC must prevent concurrent workers from claiming the same order");
  assert.match(sql, /grant execute on function public\.claim_qbo_orders\(int\) to service_role/,
    "service role must be allowed to execute the claim RPC");
});

test("QBO env example documents the sync endpoint secret", () => {
  const env = read(".env.example");
  assert.match(env, /QBO_SYNC_SECRET=/,
    "QBO cron endpoint must be protected by a shared secret");
});

test("new NET and Stripe orders enter the QBO sync queue", () => {
  const checkout = read("functions/api/checkout.js");
  const webhook = read("functions/api/stripe-webhook.js");

  assert.match(checkout, /payment_method:\s*'net'[\s\S]*qbo_sync_status:\s*'pending'/,
    "NET checkout orders should start pending QBO invoice sync");
  assert.match(webhook, /payment_method:\s*'stripe'[\s\S]*qbo_sync_status:\s*'pending'/,
    "Stripe checkout orders should start pending QBO sales receipt sync");
});

test("admin QBO status exposes failed orders for staff triage", () => {
  const src = readFileSync(new URL("../functions/api/admin/qbo/status.js", import.meta.url), "utf8");
  assert.match(src, /qbo_failed_orders/);
  assert.match(src, /qbo_sync_status'\s*,\s*'error'/);
  assert.match(src, /qbo_error/);
  assert.match(src, /qbo_attempts/);
  assert.match(src, /qbo_next_attempt_at/);
});

test("admin QBO retry endpoint requeues a failed order", () => {
  const src = readFileSync(new URL("../functions/api/admin/qbo/retry.js", import.meta.url), "utf8");
  assert.match(src, /requireStaff/);
  assert.match(src, /qbo_sync_status:\s*'pending'/);
  assert.match(src, /qbo_attempts:\s*0/);
  assert.match(src, /qbo_next_attempt_at:\s*null/);
});
