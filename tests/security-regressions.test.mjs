// Security regressions for the admin money + email paths. Salvaged from the stale
// fix/ux-optimize branch and updated to current main, where it caught two live
// regressions now fixed here: the admin refund had lost its Stripe idempotency key,
// and notifyCompany rendered staff-controlled text (a NET reference) unescaped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emailLayout } from "../functions/_lib/supabase.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("emailLayout escapes CTA text and blocks unsafe CTA URLs", () => {
  const unsafe = emailLayout({
    heading: "Offer",
    bodyHtml: "<p>Body</p>",
    ctaText: "View offer",
    ctaUrl: "javascript:alert(1)",
  });
  assert.doesNotMatch(unsafe, /javascript:alert\(1\)/, "unsafe CTA href must not render");
  assert.doesNotMatch(unsafe, />View offer<\/a>/, "unsafe CTA must not render");

  const escaped = emailLayout({
    heading: "Offer",
    bodyHtml: "<p>Body</p>",
    ctaText: "View <offer>",
    ctaUrl: 'https://masest.co/products.html?q="crhd"',
  });
  assert.match(escaped, /View &lt;offer&gt;/);
  assert.match(escaped, /q=%22crhd%22/);
});

test("admin notifications escape staff-controlled email text", () => {
  const orders = read("functions/api/admin/orders.js");
  const offers = read("functions/api/admin/offers.js");
  // The dynamic `extra` body can carry staff input (e.g. a manual NET settlement
  // reference). Both notification paths must escape it before it reaches the email.
  assert.match(orders, /bodyHtml: `<p>\$\{htmlEscape\(extra \|\|/, "notifyCompany must escape extra");
  assert.match(orders, /htmlEscape\(extra \|\| `Your order is now/, "notifyBuyerTracking must escape extra");
  assert.match(offers, /htmlEscape\(title\)/);
  assert.match(offers, /htmlEscape\(String\(body\.body \|\| ''\)\)/);
});

test("admin refund rejects non-Stripe and already-settled orders", () => {
  const orders = read("functions/api/admin/orders.js");
  assert.match(orders, /REFUND_BLOCKING_STATUSES\.has\(ord\.status\)/, "blocks cancelled/refunded orders");
  assert.match(orders, /ord\.payment_method !== 'stripe' \|\| !ord\.stripe_payment_intent/, "Stripe-paid orders only");
  assert.match(orders, /computeRefund\(/, "amount is validated against the remaining balance");
});

test("admin refund sends Stripe a deterministic idempotency key", () => {
  const orders = read("functions/api/admin/orders.js");
  // Without an idempotency key a retried or concurrent double-submit double-refunds.
  assert.match(
    orders,
    /const idempotencyKey = `refund:\$\{ord\.id\}:\$\{ord\.refunded_amount \|\| 0\}:\$\{plan\.amountCents\}`/,
    "key is deterministic per refund attempt (allows distinct partials, dedupes retries)",
  );
  assert.match(
    orders,
    /refunds\.create\(\s*\{ payment_intent: ord\.stripe_payment_intent, amount: plan\.amountCents \},\s*\{ idempotencyKey \},/,
    "the key is passed to Stripe",
  );
});

test("Stripe redirect endpoints require canonical APP_URL", () => {
  for (const path of [
    "functions/api/checkout.js",
    "functions/api/programs/subscribe.js",
    "functions/api/account/billing-portal.js",
  ]) {
    const source = read(path);
    assert.match(source, /app_url_not_configured/);
    assert.doesNotMatch(source, /new URL\(request\.url\)\.origin|headers\.get\(['"]host['"]\)/);
  }
});
