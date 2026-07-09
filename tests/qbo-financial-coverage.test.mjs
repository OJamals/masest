import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Stripe program invoices have an idempotent QuickBooks queue", () => {
  const schema = read("supabase/schema-qbo-subscriptions.sql");
  const reaper = read("supabase/schema-qbo-reaper.sql");
  const hardening = read("supabase/schema-rpc-hardening.sql");
  const webhook = read("functions/api/stripe-webhook.js");
  const sync = read("functions/api/qbo-sync.js");

  assert.match(schema, /create table if not exists public\.qbo_subscription_invoices/);
  assert.match(schema, /stripe_invoice_id\s+text not null unique/);
  assert.match(schema, /claim_qbo_subscription_invoices\(batch int\)/);
  assert.match(schema, /for update skip locked/);
  assert.match(reaper, /claim_qbo_subscription_invoices[\s\S]*qbo_sync_status in \('pending', 'processing'\)/);
  assert.match(hardening, /revoke all on function public\.claim_qbo_subscription_invoices\(int\) from public/);
  assert.match(webhook, /qboSubscriptionInvoiceRow\(/);
  assert.match(webhook, /onConflict:\s*'stripe_invoice_id'/);
  assert.match(sync, /runQboSubscriptionSync/);
  assert.match(sync, /syncSubscriptionInvoice\(/);
});

test("approved businesses are linked before financial documents sync", () => {
  const sync = read("functions/api/qbo-sync.js");
  assert.match(sync, /runQboBusinessSync/);
  assert.match(sync, /status',\s*'approved'/);
  assert.match(sync, /findOrCreateCustomer\(/);
  assert.match(sync, /runAllQboSync[\s\S]*runQboBusinessSync[\s\S]*runQboSync/);
});

test("admin QuickBooks controls cover every financial queue", () => {
  const status = read("functions/api/admin/qbo/status.js");
  const retry = read("functions/api/admin/qbo/retry.js");
  const manual = read("functions/api/admin/qbo/sync.js");
  const ui = read("js/admin/qbo.js");

  assert.match(status, /subscription_sync_counts/);
  assert.match(status, /business_sync_counts/);
  assert.match(status, /qbo_failed_subscriptions/);
  assert.match(retry, /qbo_subscription_invoices/);
  assert.match(manual, /runAllQboSync/);
  assert.match(ui, /Programs:/);
  assert.match(ui, /Businesses:/);
});
