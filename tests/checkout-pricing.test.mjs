// Price-integrity contract for /api/checkout (revenue-critical). The amount charged must
// always derive from server state (product_variants.price + tier overrides from the DB),
// never from a client-supplied price in the request body. Guards against a tampered cart
// payload setting its own price.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/checkout.js", import.meta.url), "utf8");

test("the client cart is normalized to {sku, qty} only — no client price is read", () => {
  // normalizeCart only ever extracts sku + qty from each cart item.
  assert.match(SRC, /const\s+sku\s*=\s*String\(\s*item\.sku/);
  assert.match(SRC, /const\s+qty\s*=\s*Math\.max\(\s*0\s*,\s*Math\.floor\(\s*Number\(\s*item\.qty/);
  // The body must never feed a price into the charge.
  assert.doesNotMatch(SRC, /item\.price/, "checkout must not read a price off a client cart item");
  assert.doesNotMatch(SRC, /body\.price/, "checkout must not read a price off the request body");
});

test("prices are loaded from product_variants in the database", () => {
  assert.match(SRC, /\.from\(\s*'product_variants'\s*\)/, "must read variants from the DB");
  assert.match(SRC, /select\(\s*'[^']*\bprice\b[^']*'\s*\)/, "must select the server price column");
  // The sellable line price is the DB variant price, not anything from the request.
  assert.match(SRC, /price:\s*v\.price/, "sellable line price must come from the variant row");
});

test("tier discounts are applied from server-side price_tiers, not the client", () => {
  assert.match(SRC, /tierForRequest\(\s*request\s*,\s*env\s*\)/);
  assert.match(SRC, /tierPriceMap\(\s*sb\s*,\s*tier\s*\)/, "overrides must be loaded server-side");
  assert.match(SRC, /line\.price\s*=\s*overrides\.get\(\s*line\.sku\s*\)/,
    "a tier override replaces the line price from the server map");
});

test("Stripe line amounts are computed from the server price", () => {
  assert.match(SRC, /unit_amount:\s*Math\.round\(\s*Number\(\s*p\.price\s*\)\s*\*\s*100\s*\)/,
    "Stripe unit_amount must be derived from the server price p.price");
  // Reuse a pre-created Stripe Price id when present, else price_data from p.price — both server-sourced.
  assert.match(SRC, /p\.stripe_price_id/);
});

test("NET account orders persist the server price and matching line totals", () => {
  assert.match(SRC, /unit_price:\s*p\.price/, "NET order line unit_price must be the server price");
  assert.match(SRC, /line_total:\s*Number\(\s*p\.price\s*\)\s*\*\s*qtyBySku\[p\.sku\]/,
    "NET line_total must be server price * server-normalized qty");
  assert.match(SRC, /subtotal\s*=\s*sellable\.reduce\([\s\S]*?Number\(p\.price\)\s*\*\s*qtyBySku\[p\.sku\]/,
    "NET subtotal must sum server price * qty");
});
