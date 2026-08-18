// Security regressions for the admin money + email paths. Salvaged from the stale
// fix/ux-optimize branch and updated to current main, where it caught two live
// regressions now fixed here: the admin refund had lost its Stripe idempotency key,
// and notifyCompany rendered staff-controlled text (a NET reference) unescaped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emailLayout, json } from "../functions/_lib/supabase.js";
import { refundCommandPlan } from "../functions/_lib/order-reversal.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("repository keeps npm lockfile trackable and ignores common local secret files", () => {
  const ignore = read(".gitignore");
  assert.doesNotMatch(ignore, /^package-lock\.json\s*$/m);
  assert.match(ignore, /^\.env\s*$/m);
  assert.match(ignore, /^\.env\.\*\s*$/m);
  assert.match(ignore, /^!\.env\.example\s*$/m);
  assert.match(ignore, /^\*\.pem\s*$/m);
  assert.match(ignore, /^\*\.key\s*$/m);
  assert.doesNotThrow(() => JSON.parse(read("package-lock.json")));
});

test("JSON responses default to no-store while explicit cache policy wins", () => {
  assert.equal(json(401, { error: "unauthenticated" }).headers.get("cache-control"), "no-store");
  assert.equal(
    json(200, { ok: true }, { "cache-control": "public, max-age=60" }).headers.get("cache-control"),
    "public, max-age=60",
  );
});

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
  // The shipment-email body moved into the shared builder so the automatic carrier-scan
  // path and the manual staff update render identically — the escape moved with it.
  const orderEmail = read("functions/_lib/order-email.js");
  assert.match(orderEmail, /htmlEscape\(extra \|\| `Your order is now/, "shipmentEmailHtml must escape extra");
  assert.match(orders, /shipmentEmailHtml\(order, label, extra\)/, "tracking email must use the escaping builder");
  assert.match(offers, /htmlEscape\(title\)/);
  assert.match(offers, /htmlEscape\(String\(body\.body \|\| ''\)\)/);
});

test("admin refund rejects non-Stripe and already-settled orders", () => {
  const base = {
    id: 'order-1', status: 'paid', payment_method: 'stripe', stripe_payment_intent: 'pi_1',
    total: 100, refunded_amount: 0, currency: 'usd', reversal_revision: 0,
    order_items: [{ sku: 'VK-1', qty: 1, unit_price: 100, backordered: false }],
  };
  assert.equal(refundCommandPlan({ ...base, payment_method: 'net', stripe_payment_intent: null }, {
    requestId: 'refund:security-net',
  }).error, 'not_refundable');
  assert.equal(refundCommandPlan({ ...base, status: 'cancelled' }, {
    requestId: 'refund:security-cancelled',
  }).error, 'not_refundable');
  assert.equal(refundCommandPlan({ ...base, refunded_amount: 100 }, {
    requestId: 'refund:security-settled',
  }).error, 'already_refunded');
});

test("admin refund sends Stripe a deterministic idempotency key", () => {
  const order = {
    id: 'order-1', status: 'paid', payment_method: 'stripe', stripe_payment_intent: 'pi_1',
    total: 100, refunded_amount: 0, currency: 'usd', reversal_revision: 0,
    order_items: [{ sku: 'VK-1', qty: 1, unit_price: 100, backordered: false }],
  };
  const first = refundCommandPlan(order, { requestId: 'refund:security-attempt-1', amount: 25 });
  const replay = refundCommandPlan(order, { requestId: 'refund:security-attempt-1', amount: 25 });
  const distinct = refundCommandPlan(order, { requestId: 'refund:security-attempt-2', amount: 25 });
  assert.equal(first.provider_idempotency_key, replay.provider_idempotency_key);
  assert.notEqual(first.provider_idempotency_key, distinct.provider_idempotency_key);
  const effects = read("functions/_lib/integration-effects.js");
  assert.match(effects, /idempotencyKey = String\(command\.provider_idempotency_key/);
  assert.match(effects, /createRefund\(env, \{ paymentIntent, amountCents, idempotencyKey \}\)/);
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
