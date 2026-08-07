import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin list empties use the shared admEmpty primitive, not ad-hoc <p class=muted>", () => {
  const pricing = read("js/admin/pricing.js");
  assert.match(
    pricing,
    /admEmpty\(\s*'ph-[a-z-]+',\s*q \? 'No matching prices' : 'No pricing records'/,
    "pricing should use a search-aware admEmpty for every managed price type",
  );
  assert.doesNotMatch(pricing, /<p class="muted"[^>]*>No (?:variants|pricing records)/, "pricing should drop hand-rolled empties");

  // The inbox moved to the shared js/admin-support.js console (one support UI on
  // both admin and public surfaces), which ships its own empty state.
  const support = read("js/admin-support.js");
  assert.match(support, /site-support__empty/, "support console should render an empty state");
  assert.doesNotMatch(read("js/admin/threads.js"), /<p class="muted">No conversations/, "threads should not hand-roll an empty");

  const coupons = read("js/admin/coupons.js");
  assert.match(coupons, /admEmpty\('ph-[a-z-]+', 'No promo codes yet'/, "coupons should use admEmpty");
  assert.doesNotMatch(coupons, /<p class="muted">No promo codes/, "coupons should drop the hand-rolled empty");
});

test("tabs that render list empties are wired with admEmpty", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /createPricingTab\(\{[^}]*\badmEmpty\b/, "pricing tab should receive admEmpty");

  const pricing = read("js/admin/pricing.js");
  assert.match(pricing, /createPricingTab\(\{[^}]*\badmEmpty\b/, "pricing factory should destructure admEmpty");
  // threads.js delegates the inbox to js/admin-support.js, so it renders no list
  // of its own and takes no empty-state primitive.
  const threads = read("js/admin/threads.js");
  assert.doesNotMatch(threads, /admEmpty/, "threads should not render list empties");
});

test("coupons and low-stock lists show a loading skeleton like sibling tabs", () => {
  const coupons = read("js/admin/coupons.js");
  const inventory = read("js/admin/inventory.js");
  assert.match(coupons, /async function renderCoupons[\s\S]*?box\.innerHTML = admSkeleton\(\)/, "renderCoupons should paint admSkeleton before awaiting the fetch");
  assert.match(inventory, /async function renderLowStock[\s\S]*?box\.innerHTML = admSkeleton\(\)/, "renderLowStock should paint admSkeleton before awaiting the fetch");
});

test("low-stock empty state uses the shared admEmpty primitive", () => {
  const inventory = read("js/admin/inventory.js");
  assert.match(inventory, /async function renderLowStock[\s\S]*?admEmpty\('ph-[a-z-]+', 'No low-stock variants'/, "renderLowStock empty should use admEmpty");
  assert.doesNotMatch(inventory, /<p class="muted">No variants at or below/, "renderLowStock should drop the hand-rolled empty");
});
