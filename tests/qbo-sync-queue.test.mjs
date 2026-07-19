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
  for (const column of ["qbo_sync_status", "qbo_doc_id", "qbo_doc_type", "qbo_payment_id", "qbo_intuit_tid", "qbo_payment_intuit_tid", "qbo_intuit_tids", "qbo_synced_at", "qbo_error", "qbo_attempts", "qbo_next_attempt_at"]) {
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

test("QuickBooks setup docs call out online invoice payment requirements", () => {
  const env = read(".env.example");
  const cf = read("CLOUDFLARE_PAGES.md");

  assert.match(env, /QuickBooks Payments/i);
  assert.match(cf, /QuickBooks Payments/i);
  assert.match(cf, /online card and ACH/i);
});

test("new NET and Stripe orders enter the QBO sync queue", () => {
  const orderIntegrity = read("supabase/schema-order-integrity.sql");
  const webhook = read("functions/api/stripe-webhook.js");
  const orderShape = read("functions/_lib/order-shape.js");

  assert.match(orderIntegrity,
    /function\s+public\.place_net_order_v2[\s\S]*qbo_sync_status[\s\S]*'pending'/i,
    "atomic NET checkout orders should start pending QBO invoice sync");
  // The Stripe paid-order row is built by order-shape.js (orderRowFromSession), which the
  // webhook delegates to; the row must still mark the order pending QBO sync.
  assert.match(webhook, /orderRowFromSession\(/,
    "webhook should build the paid order via orderRowFromSession");
  // Settled card orders queue immediately; unsettled ACH orders hold at null until
  // async_payment_succeeded releases them (claim_qbo_orders only takes 'pending').
  assert.match(orderShape, /payment_method:\s*['"]stripe['"][\s\S]*qbo_sync_status:\s*settled\s*\?\s*['"]pending['"]\s*:\s*null/,
    "Stripe checkout orders should start pending QBO sync only once payment settled");
  assert.match(webhook, /async_payment_succeeded[\s\S]*qbo_sync_status:\s*'pending'/,
    "ACH settlement should release the order into the QBO sync queue");
});

test("QBO invoice auto-sync notifies the buyer company when the invoice is ready", () => {
  const src = read("functions/api/qbo-sync.js");

  assert.match(src, /notifyInvoiceReady\(/, "QBO sync should notify buyers when an invoice is created");
  assert.match(src, /from\('notifications'\)\.insert/, "QBO sync should write an in-app buyer notification");
  assert.match(src, /QuickBooks invoice \$\{result\.docId\}/,
    "buyer notification should include the QuickBooks invoice id");
});

test("QBO sync records invoice and Stripe-linked payment ids", () => {
  const src = read("functions/api/qbo-sync.js");

  assert.match(src, /result\.docType === 'invoice' \|\| result\.docType === 'invoice_payment'/,
    "invoice id should be recorded for NET invoices and Stripe-paid invoice records");
  assert.match(src, /patch\.qbo_payment_id = result\.paymentId/,
    "Stripe-linked QBO payment id should be stored on the order");
});

test("QBO sync stores Intuit transaction ids for support traceability", () => {
  const schema = read("supabase/schema-qbo.sql");
  const refunds = read("supabase/schema-qbo-refunds.sql");
  const src = read("functions/api/qbo-sync.js");

  assert.match(schema, /qbo_intuit_tid text/, "orders should store the primary Intuit transaction id");
  assert.match(schema, /qbo_intuit_tids jsonb not null default '\[\]'::jsonb/, "orders should store all captured Intuit transaction ids");
  assert.match(refunds, /qbo_intuit_tid\s+text/, "refund credit memos should store the primary Intuit transaction id");
  assert.match(refunds, /qbo_intuit_tids\s+jsonb not null default '\[\]'::jsonb/, "refund credit memos should store all captured Intuit transaction ids");
  assert.match(src, /patch\.qbo_intuit_tid = result\.intuitTid/, "order sync should persist the invoice Intuit transaction id");
  assert.match(src, /patch\.qbo_payment_intuit_tid = result\.paymentIntuitTid/, "order sync should persist the payment Intuit transaction id");
  assert.match(src, /patch\.qbo_intuit_tids = result\.intuitTids/, "order sync should persist the full Intuit transaction id trail");
  assert.match(src, /qbo_intuit_tid:\s*result\.intuitTid/, "refund sync should persist the CreditMemo Intuit transaction id");
});

test("admin QBO status exposes failed orders for staff triage", () => {
  const src = readFileSync(new URL("../functions/api/admin/qbo/status.js", import.meta.url), "utf8");
  assert.match(src, /qbo_failed_orders/);
  assert.match(src, /qbo_failed_refunds/);
  assert.match(src, /refund_sync_counts/);
  assert.match(src, /qbo_sync_status'\s*,\s*'error'/);
  assert.match(src, /qbo_error/);
  assert.match(src, /qbo_attempts/);
  assert.match(src, /qbo_next_attempt_at/);
});

test("admin QBO retry endpoint requeues a failed order", () => {
  const src = readFileSync(new URL("../functions/api/admin/qbo/retry.js", import.meta.url), "utf8");
  assert.match(src, /requireStaff/);
  assert.match(src, /body\.kind === 'refund'/);
  assert.match(src, /qbo_refunds/);
  assert.match(src, /qbo_sync_status:\s*'pending'/);
  assert.match(src, /qbo_attempts:\s*0/);
  assert.match(src, /qbo_next_attempt_at:\s*null/);
});
