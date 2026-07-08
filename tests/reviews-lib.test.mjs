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

// append to tests/reviews-lib.test.mjs
import { reviewToken, verifyReviewToken } from "../functions/_lib/reviews.js";

test("reviewToken round-trips and is order+sku+email bound", async () => {
  const secret = "s3cr3t";
  const tok = await reviewToken({ orderId: "o1", sku: "cr", email: "Buyer@X.com" }, secret);
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.equal(await verifyReviewToken({ orderId: "o1", sku: "cr", email: "buyer@x.com" }, tok, secret), true);
  // email lowercased in the subject, so case does not matter
  assert.equal(await verifyReviewToken({ orderId: "o1", sku: "cr", email: "BUYER@X.COM" }, tok, secret), true);
});

test("verifyReviewToken rejects tampering + missing secret", async () => {
  const secret = "s3cr3t";
  const tok = await reviewToken({ orderId: "o1", sku: "cr", email: "a@x.com" }, secret);
  assert.equal(await verifyReviewToken({ orderId: "o2", sku: "cr", email: "a@x.com" }, tok, secret), false);
  assert.equal(await verifyReviewToken({ orderId: "o1", sku: "descaler", email: "a@x.com" }, tok, secret), false);
  assert.equal(await verifyReviewToken({ orderId: "o1", sku: "cr", email: "a@x.com" }, "deadbeef", secret), false);
  assert.equal(await verifyReviewToken({ orderId: "o1", sku: "cr", email: "a@x.com" }, tok, ""), false);
});
