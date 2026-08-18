// Price-integrity contract for /api/checkout (revenue-critical). The amount charged must
// always derive from server state (product_variants.price + tier overrides from the DB),
// never from a client-supplied price in the request body. Guards against a tampered cart
// payload setting its own price.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/checkout.js", import.meta.url), "utf8");
const CHECKOUT_SESSION = readFileSync(new URL("../functions/_lib/checkout-session.js", import.meta.url), "utf8");
const ORDER_SHAPE = readFileSync(new URL("../functions/_lib/order-shape.js", import.meta.url), "utf8");
const CART_JS = readFileSync(new URL("../js/cart.js", import.meta.url), "utf8");

// Regression: the browser cart client and the checkout API must agree on the request
// payload key. A prior refactor renamed the server read to `body.cart` while js/cart.js
// still posted `items`, so every live checkout returned 400 cart_empty.
// Regression: authentication, Company, pricing, and tax used to be independently loaded,
// which allowed one failed read to silently downgrade a Buyer. Checkout must consume the
// one typed commerce snapshot instead of assigning a userFromRequest wrapper directly.
test("checkout consumes one typed commerce snapshot", () => {
  assert.doesNotMatch(SRC, /\bconst\s+user\s*=\s*await\s+userFromRequest\b/,
    "checkout.js must not assign the userFromRequest wrapper directly to `user`");
  assert.match(SRC, /commerce\s*=\s*await\s+getCommerceContext\(request,\s*env\)/,
    "checkout.js must resolve the commerce context once");
  assert.match(SRC, /const\s*\{[^}]*\bsb\b[^}]*\buser\b[^}]*\bcompany\b[^}]*\bcompanyId\b[^}]*\btier\b[^}]*\btaxExempt\b[^}]*\}\s*=\s*commerce/,
    "checkout.js must derive identity, account, pricing, and tax from that snapshot");
});

test("client cart payload key matches what the checkout API reads", () => {
  assert.match(CART_JS, /fetch\(\s*["']\/api\/checkout["']/, "cart.js must POST to /api/checkout");
  assert.match(CART_JS, /cart:\s*line/, "cart.js must send the line items under the canonical `cart` key");
  assert.match(SRC, /normalizeCartQuantities\(\s*body\.cart\s*\)/,
    "checkout.js must read canonical body.cart");
  assert.doesNotMatch(SRC, /body\.items/, "stale cart payload aliases should not return");
});

test("the client cart is normalized to {sku, qty} only — no client price is read", () => {
  assert.match(ORDER_SHAPE, /typeof\s+item\.sku\s*!==\s*["']string["']/);
  assert.match(ORDER_SHAPE, /Number\.isInteger\(\s*item\.qty\s*\)/);
  assert.match(SRC, /normalizeCartQuantities\(body\.cart\)/);
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
  assert.match(SRC, /const\s*\{[^}]*\btier\b[^}]*\}\s*=\s*commerce/);
  assert.match(SRC, /getTierPriceMap\(\s*sb\s*,\s*tier\s*\)/, "overrides must be loaded server-side");
  assert.match(SRC, /line\.price\s*=\s*overrides\.get\(\s*line\.sku\s*\)/,
    "a tier override replaces the line price from the server map");
});

test("Stripe line amounts are computed from the server price", () => {
  assert.match(SRC, /buildStripeCheckoutSessionParams\(\{/,
    "checkout API must create Stripe sessions through the shared checkout-session builder");
  assert.match(CHECKOUT_SESSION, /unit_amount:\s*Math\.round\(\s*Number\(\s*product\.price\s*\)\s*\*\s*100\s*\)/,
    "Stripe unit_amount must be derived from the server price product.price");
  // Reuse a pre-created Stripe Price id when present, else price_data from product.price — both server-sourced.
  assert.match(CHECKOUT_SESSION, /product\.stripe_price_id/);
});

// The endpoint prices card/ACH orders only; it writes no order rows of its own, so there
// is no app-side unit_price/line_total to pin. The one price it must never trust is the
// client's — every line is re-priced from product_variants or an accepted quote above.
test("checkout writes no order lines of its own", () => {
  assert.doesNotMatch(SRC, /unit_price:\s*Number\(\s*p\.price\s*\)/,
    "checkout must not build order-item rows in the Worker");
  assert.doesNotMatch(SRC, /from\(['"]order_items['"]\)\.insert/,
    "checkout must not insert order items");
});
