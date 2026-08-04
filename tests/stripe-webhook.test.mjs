// Contract + unit tests for the Stripe webhook (revenue-critical: payment -> order
// persistence). Covers signature verification ordering, idempotency (no duplicate
// orders/effects on Stripe retries), durable inventory dispatch, and escapeHtml.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHtml } from "../functions/api/stripe-webhook.js";

const SRC = readFileSync(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");
// Persistence shapes were extracted to _lib/order-shape.js (pure, unit-tested in
// tests/stripe-webhook-shape.test.mjs); some contract checks below assert delegation
// to it and pin the money math at its source of truth.
const SHAPE = readFileSync(new URL("../functions/_lib/order-shape.js", import.meta.url), "utf8");
const EFFECTS = readFileSync(new URL("../functions/_lib/stripe-effects.js", import.meta.url), "utf8");
const EFFECT_SQL = readFileSync(new URL("../supabase/schema-stripe-effects.sql", import.meta.url), "utf8");

// --- Unit: escapeHtml (imported, executed for real) ---
test("escapeHtml escapes all five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
});

test("escapeHtml coerces null/undefined to an empty string (no 'null' in emails)", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
});

test("escapeHtml neutralizes an injected order-line name", () => {
  const evil = `Acme <img src=x onerror=alert(1)>`;
  const out = escapeHtml(evil);
  assert.doesNotMatch(out, /<img/, "must not emit a live tag");
  assert.match(out, /&lt;img/);
});

// --- Contract: signature verified BEFORE any state change ---
test("webhook verifies the Stripe signature before acting", () => {
  assert.match(SRC, /constructEventAsync\(/, "must verify via constructEventAsync");
  assert.match(SRC, /createSubtleCryptoProvider\(/, "must use the Workers SubtleCrypto provider");
  assert.match(SRC, /return\s+json\(\s*400\s*,\s*\{\s*error:\s*'invalid_signature'/,
    "must reject an invalid signature with 400 before processing");
  assert.doesNotMatch(SRC, /invalid_signature'\s*,\s*detail\s*:/,
    "must not reflect Stripe signature parser details to an unauthenticated caller");

  const verifyIdx = SRC.indexOf("constructEventAsync");
  const firstInsertIdx = SRC.indexOf(".insert(");
  const enqueueIdx = SRC.indexOf("await enqueueRequiredEffects(", SRC.indexOf("export async function handleStripeWebhook"));
  assert.ok(verifyIdx > 0, "signature verification must exist");
  assert.ok(verifyIdx < firstInsertIdx,
    "signature must be verified before any DB insert");
  assert.ok(verifyIdx < enqueueIdx,
    "signature must be verified before any durable effect enqueue");
});

// --- Contract: atomic + idempotent paid-order persistence ---
test("webhook persists the order and all line items through one atomic RPC", () => {
  assert.match(SRC, /sb\.rpc\(\s*'persist_stripe_order'/,
    "must persist the order header and its line items in one database transaction");
  assert.doesNotMatch(SRC, /sb\.from\(\s*'order_items'\s*\)\.insert/,
    "must not separately insert line items after committing the order header");
  assert.match(SRC, /const\s+itemRows\s*=\s*orderItemRows\(lines,\s*null\)/,
    "must prepare line-item snapshots before invoking the atomic persistence RPC");
});

test("webhook treats the RPC unique violation as an idempotent Stripe retry", () => {
  assert.match(SRC, /const\s+insertOutcome\s*=\s*classifyOrderInsert\(orderErr\)/);
  assert.match(SRC,
    /if\s*\(\s*insertOutcome\s*===\s*'duplicate'\s*\)[\s\S]*order_effect_recovery_failed[\s\S]*await\s+enqueueRequiredEffects\(/,
    "a duplicate PaymentIntent must recover the order and enqueue missing effects");
  assert.match(SRC, /insertOutcome\s*===\s*'duplicate'\s*\?\s*\{\s*duplicate:\s*true\s*\}/,
    "a recovered duplicate must be acknowledged with HTTP 200 duplicate=true");
});

test("webhook joins each Stripe object to the canonical order and writes its public number back", () => {
  assert.match(SRC, /linkOrderProviderObject\([\s\S]*objectType:\s*'checkout_session'/);
  assert.match(SRC, /linkOrderProviderObject\([\s\S]*objectType:\s*'payment_intent'/);
  assert.match(SRC, /updateCheckoutSession\(s\.id,\s*\{\s*metadata:\s*\{\s*order_number:/);
  assert.match(SRC, /select\('id,order_number,company_id'\)/,
    "the webhook must load the DB-assigned public number before provider linking");
});

// --- Contract: inventory decrement is a durable, idempotent provider effect ---
test("webhook durably enqueues stock after persistence; worker applies it atomically", () => {
  assert.match(SRC, /stage:\s*settled\s*\?\s*'card'\s*:\s*'ach_pending'/,
    "settled card orders must plan stock while pending ACH must defer it");
  assert.match(EFFECTS, /effect\(\s*'stock-decrement'\s*,\s*'stock_decrement'/,
    "settled order plans must include stock decrement");
  assert.match(EFFECTS, /'oversell-alert'[\s\S]*'stock-decrement'/,
    "oversell alert must depend on completed stock result");
  assert.match(EFFECT_SQL, /create\s+or\s+replace\s+function\s+public\.apply_stripe_stock_effect/i);
  assert.match(EFFECT_SQL, /select\s+public\.decrement_variant_stock/i,
    "stock provider RPC must reuse the atomic decrement primitive");
  assert.match(EFFECT_SQL, /provider_succeeded_at\s*=\s*now\(\)/i,
    "stock mutation and provider success marker must share the SQL transaction");
  const orderInsertIdx = SRC.indexOf("orderRowFromSession(");
  const enqueueIdx = SRC.indexOf("await enqueueRequiredEffects(", orderInsertIdx);
  assert.ok(orderInsertIdx > 0 && orderInsertIdx < enqueueIdx,
    "effect enqueue must happen after the order is recorded");
});

// --- Contract: monetary math is derived, not trusted from arbitrary fields ---
test("order totals come from Stripe amount_* fields (cents -> dollars)", () => {
  // Webhook derives totals via centsToAmount(); the cents->dollars math is pinned in
  // tests/stripe-webhook-shape.test.mjs against order-shape.js.
  assert.match(SRC, /const\s+subtotal\s*=\s*centsToAmount\(s\.amount_subtotal\)/);
  assert.match(SRC, /const\s+tax\s*=\s*centsToAmount\(s\.total_details\?\.amount_tax\)/);
  assert.match(SRC, /const\s+total\s*=\s*centsToAmount\(s\.amount_total\)/);
  assert.match(SHAPE, /return\s*\(cents\s*\?\?\s*0\)\s*\/\s*100/,
    "centsToAmount must convert integer minor units to dollars");
});

test("order_items line_total is unit_price * qty", () => {
  assert.match(SRC, /orderItemRows\(lines,\s*null\)/,
    "webhook must build order_items via orderItemRows");
  assert.match(SHAPE, /line_total:\s*l\.unit_price\s*\*\s*l\.qty/,
    "orderItemRows must compute each line total as unit_price * qty");
});
