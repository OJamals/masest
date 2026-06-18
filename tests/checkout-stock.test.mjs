import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("checkout validates stock-tracked variants before creating payment or NET orders", () => {
  for (const path of ["functions/api/checkout.js", "netlify/functions/checkout.js"]) {
    const source = read(path);
    assert.match(source, /stock,track_stock/, `${path} must select variant stock fields`);
    assert.match(source, /outOfStock/, `${path} must separate inventory failures`);
    assert.match(source, /error:\s*'out_of_stock'/, `${path} must return an explicit out_of_stock error`);
    assert.match(source, /decrementVariantStock/, `${path} must decrement tracked stock for NET orders`);
    assert.match(source, /decrement_variant_stock/, `${path} must use the atomic stock RPC`);
  }
});

test("stripe webhook decrements variant stock after paid checkout", () => {
  for (const path of ["functions/api/stripe-webhook.js", "netlify/functions/stripe-webhook.js"]) {
    const source = read(path);
    assert.match(source, /decrementVariantStock/, `${path} must decrement variant inventory`);
    assert.match(source, /decrement_variant_stock/, `${path} must use the atomic stock RPC`);
    assert.doesNotMatch(source, /from\('products'\)\.select\('sku,track_stock,stock'\)/, `${path} must not decrement parent product stock`);
  }
});

test("phase-5 schema installs atomic variant stock decrement RPC", () => {
  const schema = read("supabase/schema-phase5.sql");
  assert.match(schema, /create or replace function public\.decrement_variant_stock/i);
  assert.match(schema, /stock = stock - p_qty/i);
  assert.match(schema, /grant execute on function public\.decrement_variant_stock/i);
});
