import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewInput, escapeHtml } from "../functions/_lib/reviews.js";

test("validateReviewInput accepts a good review, clamps + trims", () => {
  const r = validateReviewInput({ rating: "5", title: "  Great  ", body: "Worked well", kind: "product", sku: "cr" });
  assert.equal(r.ok, true);
  assert.equal(r.value.rating, 5);
  assert.equal(r.value.title, "Great");
  assert.equal(r.value.kind, "product");
});

test("validateReviewInput rejects out-of-range / non-integer rating", () => {
  assert.equal(validateReviewInput({ rating: 0, sku: "cr" }).ok, false);
  assert.equal(validateReviewInput({ rating: 6, sku: "cr" }).ok, false);
  assert.equal(validateReviewInput({ rating: 3.5, sku: "cr" }).ok, false);
});

test("validateReviewInput rejects missing sku and normalizes kind default", () => {
  assert.equal(validateReviewInput({ rating: 4 }).ok, false);            // no sku
  assert.equal(validateReviewInput({ rating: 4, sku: "cr" }).value.kind, "product"); // default
  assert.equal(validateReviewInput({ rating: 4, sku: "x", kind: "SERVICE" }).value.kind, "service");
});

test("validateReviewInput caps title/body length", () => {
  const r = validateReviewInput({ rating: 4, sku: "cr", title: "t".repeat(300), body: "b".repeat(5000) });
  assert.equal(r.value.title.length, 120);
  assert.equal(r.value.body.length, 4000);
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml('<b>&"x"</b>'), "&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
});
