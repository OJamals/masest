import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewInput, escapeHtml, buildStaffReviewInsert } from "../functions/_lib/reviews.js";

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

test("buildStaffReviewInsert creates explicit non-verified staff reviews", () => {
  const result = buildStaffReviewInsert({
    kind: "product",
    sku: " hcr ",
    rating: "5",
    author_name: " Buyer ",
    author_email: " Buyer@Example.COM ",
    title: " Field result ",
    body: "Documented customer feedback.",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.row, {
    kind: "product",
    sku: "hcr",
    order_id: null,
    author_name: "Buyer",
    author_email: "buyer@example.com",
    rating: 5,
    title: "Field result",
    body: "Documented customer feedback.",
    verified_purchase: false,
    source: "staff_manual",
    status: "approved",
  });
});

test("buildStaffReviewInsert rejects missing identity and synthetic author emails", () => {
  assert.equal(buildStaffReviewInsert({ rating: 5, sku: "hcr", author_email: "buyer@example.com" }).error, "missing_author_name");
  assert.equal(buildStaffReviewInsert({ rating: 5, sku: "hcr", author_name: "Buyer" }).error, "missing_author_email");
  assert.equal(buildStaffReviewInsert({ rating: 5, sku: "hcr", author_name: "Buyer", author_email: "seed@masest.co" }).error, "reserved_author_email");
  assert.equal(buildStaffReviewInsert({ rating: 5, sku: "hcr", author_name: "Buyer", author_email: "not-an-email" }).error, "invalid_author_email");
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

// append to tests/reviews-lib.test.mjs
import { findVerifiedOrderId, aggregateStats } from "../functions/_lib/reviews.js";

test("findVerifiedOrderId returns the id of a fulfilled/delivered order containing the sku", () => {
  const orders = [
    { id: "o1", status: "paid", tracking_status: "processing", order_items: [{ sku: "cr" }] },
    { id: "o2", status: "fulfilled", tracking_status: "packing", order_items: [{ sku: "descaler" }] },
    { id: "o3", status: "net_open", tracking_status: "delivered", order_items: [{ sku: "cr" }, { sku: "hcr" }] },
  ];
  assert.equal(findVerifiedOrderId(orders, "cr"), "o3");      // delivered wins over non-eligible o1
  assert.equal(findVerifiedOrderId(orders, "descaler"), "o2"); // fulfilled
  assert.equal(findVerifiedOrderId(orders, "nope"), null);     // not purchased
  assert.equal(findVerifiedOrderId([{ id: "o1", status: "paid", order_items: [{ sku: "cr" }] }], "cr"), null); // paid-only not eligible
});

test("findVerifiedOrderId matches base product_sku when line sku is a variant (normal checkout)", () => {
  // Small-pack checkout stores the variant sku in `sku` and the base sku in `product_sku`.
  // A review keyed on the base sku ('cr-hd') must still match.
  const orders = [
    { id: "o4", status: "fulfilled", order_items: [{ sku: "VK-CRHD-5G", product_sku: "cr-hd" }] },
  ];
  assert.equal(findVerifiedOrderId(orders, "cr-hd"), "o4");           // base sku matches via product_sku
  assert.equal(findVerifiedOrderId(orders, "VK-CRHD-5G"), null);      // variant sku is not the review key
});

test("aggregateStats computes avg, count, distribution from approved rows", () => {
  const rows = [{ rating: 5 }, { rating: 5 }, { rating: 4 }, { rating: 3 }];
  const s = aggregateStats(rows);
  assert.equal(s.count, 4);
  assert.equal(s.avg, 4.3);   // (5+5+4+3)/4 = 4.25 → rounded to 1 dp = 4.3
  assert.deepEqual(s.dist, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 });
});

test("aggregateStats handles empty", () => {
  assert.deepEqual(aggregateStats([]), { avg: 0, count: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
});
