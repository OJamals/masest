import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin list empties use the shared admEmpty primitive, not ad-hoc <p class=muted>", () => {
  const pricing = read("js/admin/pricing.js");
  assert.match(pricing, /admEmpty\('ph-[a-z-]+', q \? 'No matching variants' : 'No variants'/, "pricing should use a search-aware admEmpty");
  assert.doesNotMatch(pricing, /<p class="muted"[^>]*>No variants/, "pricing should drop the hand-rolled no-variants empty");

  const threads = read("js/admin/threads.js");
  assert.match(threads, /admEmpty\('ph-[a-z-]+', 'No conversations'/, "threads should use admEmpty");
  assert.doesNotMatch(threads, /<p class="muted">No conversations/, "threads should drop the hand-rolled empty");

  const admin = read("js/admin.js");
  assert.match(admin, /admEmpty\('ph-[a-z-]+', 'No promo codes yet'/, "coupons should use admEmpty");
  assert.doesNotMatch(admin, /<p class="muted">No promo codes/, "coupons should drop the hand-rolled empty");
});

test("tabs that render list empties are wired with admEmpty", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /createPricingTab\(\{[^}]*\badmEmpty\b/, "pricing tab should receive admEmpty");
  assert.match(admin, /createThreadsTab\(\{[^}]*\badmEmpty\b/, "threads tab should receive admEmpty");

  const pricing = read("js/admin/pricing.js");
  assert.match(pricing, /createPricingTab\(\{[^}]*\badmEmpty\b/, "pricing factory should destructure admEmpty");
  const threads = read("js/admin/threads.js");
  assert.match(threads, /createThreadsTab\(\{[^}]*\badmEmpty\b/, "threads factory should destructure admEmpty");
});

test("coupons list shows a loading skeleton like sibling tabs", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /async function renderCoupons[\s\S]*?box\.innerHTML = admSkeleton\(\)/, "renderCoupons should paint admSkeleton before awaiting the fetch");
});
