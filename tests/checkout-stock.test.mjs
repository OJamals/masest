import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("checkout validates stock-tracked variants before creating payment or NET orders", () => {
  const checkout = read("functions/api/checkout.js");
  const migration = read("supabase/schema-order-integrity.sql");
  assert.match(checkout, /stock,track_stock/, "checkout must select variant stock fields");
  assert.match(checkout, /outOfStock/, "checkout must separate inventory failures");
  assert.match(checkout, /error:\s*'out_of_stock'/, "checkout must return an explicit out_of_stock error");
  assert.doesNotMatch(checkout, /decrement_variant_stock/,
    "NET stock must not mutate outside place_net_order_v2");
  assert.match(migration, /function\s+public\.place_net_order_v2/i);
  assert.match(migration, /update\s+public\.product_variants[\s\S]*stock\s*=\s*variant\.stock\s*-\s*item\.qty/i,
    "place_net_order_v2 must decrement tracked stock inside its transaction");
});

test("stripe webhook durably schedules atomic variant stock decrement after paid checkout", () => {
  const webhook = read("functions/api/stripe-webhook.js");
  const effects = read("functions/_lib/stripe-effects.js");
  const schema = read("supabase/schema-stripe-effects.sql");
  assert.match(webhook, /checkoutOrderEffects/);
  assert.match(effects, /effect\('stock-decrement',\s*'stock_decrement'/);
  assert.match(effects, /apply_stripe_stock_effect/);
  assert.match(schema, /select\s+public\.decrement_variant_stock/i);
  assert.doesNotMatch(effects, /from\('products'\)\.select\('sku,track_stock,stock'\)/,
    "Stripe effects must not decrement parent product stock");
});

test("phase-5 schema installs atomic variant stock decrement RPC", () => {
  const schema = read("supabase/schema-phase5.sql");
  assert.match(schema, /create or replace function public\.decrement_variant_stock/i);
  assert.match(schema, /stock = stock - p_qty/i);
  assert.match(schema, /grant execute on function public\.decrement_variant_stock/i);
});
