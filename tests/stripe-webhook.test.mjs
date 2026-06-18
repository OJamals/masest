// Contract + unit tests for the Stripe webhook (revenue-critical: payment -> order
// persistence). Covers signature verification ordering, idempotency (no duplicate
// orders on Stripe retries), inventory decrement, and the pure escapeHtml helper.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHtml } from "../functions/api/stripe-webhook.js";

const SRC = readFileSync(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");

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

  const verifyIdx = SRC.indexOf("constructEventAsync");
  const firstInsertIdx = SRC.indexOf(".insert(");
  const decrementIdx = SRC.indexOf("await decrementVariantStock("); // call site, not the fn definition
  assert.ok(verifyIdx > 0, "signature verification must exist");
  assert.ok(verifyIdx < firstInsertIdx,
    "signature must be verified before any DB insert");
  assert.ok(verifyIdx < decrementIdx,
    "signature must be verified before any stock decrement");
});

// --- Contract: idempotency on stripe_payment_intent (Stripe retries the same event) ---
test("webhook dedups on stripe_payment_intent before inserting an order", () => {
  assert.match(SRC, /\.eq\(\s*'stripe_payment_intent'\s*,\s*s\.payment_intent\s*\)/,
    "must look up an existing order by stripe_payment_intent");
  assert.match(SRC, /if\s*\(\s*dupe\s*\)\s*return\s+json\(\s*200\s*,[^)]*duplicate/,
    "must short-circuit (200 duplicate) when the payment intent was already recorded");

  const dupeQueryIdx = SRC.indexOf("'stripe_payment_intent', s.payment_intent");
  const dupeReturnIdx = SRC.indexOf("if (dupe)");
  const orderInsertIdx = SRC.indexOf("from('orders').insert(");
  assert.ok(dupeQueryIdx > 0 && dupeReturnIdx > dupeQueryIdx, "dupe check must follow the lookup");
  assert.ok(dupeReturnIdx < orderInsertIdx,
    "the duplicate short-circuit must run before the order insert (no duplicate orders on retry)");
});

// --- Contract: inventory decrement for stock-tracked SKUs ---
test("webhook decrements variant stock via the atomic RPC after a paid order", () => {
  assert.match(SRC, /decrement_variant_stock/, "must call the atomic decrement RPC");
  assert.match(SRC, /if\s*\(\s*order\s*&&\s*lines\.length\s*\)\s*await\s+decrementVariantStock/,
    "must only decrement once the order persisted and there are lines");

  const orderInsertIdx = SRC.indexOf("from('orders').insert(");
  const decrementIdx = SRC.indexOf("await decrementVariantStock(");
  assert.ok(orderInsertIdx < decrementIdx,
    "stock decrement must happen after the order is recorded");
});

// --- Contract: monetary math is derived, not trusted from arbitrary fields ---
test("order totals come from Stripe amount_* fields (cents -> dollars)", () => {
  assert.match(SRC, /const\s+subtotal\s*=\s*\(s\.amount_subtotal\s*\?\?\s*0\)\s*\/\s*100/);
  assert.match(SRC, /const\s+tax\s*=\s*\(s\.total_details\?\.amount_tax\s*\?\?\s*0\)\s*\/\s*100/);
  assert.match(SRC, /const\s+total\s*=\s*\(s\.amount_total\s*\?\?\s*0\)\s*\/\s*100/);
});

test("order_items line_total is unit_price * qty", () => {
  assert.match(SRC, /line_total:\s*l\.unit_price\s*\*\s*l\.qty/,
    "each persisted line total must be computed as unit_price * qty");
});
