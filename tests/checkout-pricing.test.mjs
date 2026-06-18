// Price-integrity contract for /api/checkout (revenue-critical). The amount charged must
// always derive from server state (product_variants.price + tier overrides from the DB),
// never from a client-supplied price in the request body. Guards against a tampered cart
// payload setting its own price.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/checkout.js", import.meta.url), "utf8");
const CART_JS = readFileSync(new URL("../js/cart.js", import.meta.url), "utf8");

// Regression: the browser cart client and the checkout API must agree on the request
// payload key. A prior refactor renamed the server read to `body.cart` while js/cart.js
// still posted `items`, so every live checkout returned 400 cart_empty. The server now
// accepts both, and the client posts the canonical `cart`.
// Regression: userFromRequest returns an object { user, token }. checkout.js must
// destructure it; assigning the raw wrapper to `user` makes `user.id` undefined, which
// silently broke NET checkout (company lookup) and dropped company_id from Stripe orders.
test("checkout destructures userFromRequest (never uses the raw wrapper as the user)", () => {
  assert.doesNotMatch(SRC, /\bconst\s+user\s*=\s*await\s+userFromRequest\b/,
    "checkout.js must not assign the userFromRequest wrapper directly to `user`");
  assert.match(SRC, /const\s*\{\s*user\s*\}\s*=\s*await\s+userFromRequest\(/,
    "checkout.js must destructure { user } from userFromRequest");
});

test("client cart payload key matches what the checkout API reads", () => {
  assert.match(CART_JS, /fetch\(\s*["']\/api\/checkout["']/, "cart.js must POST to /api/checkout");
  assert.match(CART_JS, /cart:\s*line/, "cart.js must send the line items under the canonical `cart` key");
  assert.match(SRC, /normalizeCart\(\s*body\.cart\s*\?\?\s*body\.items\s*\)/,
    "checkout.js must read body.cart (with body.items as a back-compat fallback)");
});

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
