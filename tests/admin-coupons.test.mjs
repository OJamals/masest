import assert from "node:assert/strict";
import test from "node:test";
import { buildCouponParams } from "../functions/_lib/coupons.js";

test("percent coupon: validates range, uppercases code, duration once", () => {
  const r = buildCouponParams({ code: "save10", percent_off: 10 });
  assert.deepEqual(r.coupon, { duration: "once", percent_off: 10 });
  assert.deepEqual(r.promo, { code: "SAVE10" });
});

test("amount coupon converts dollars to minor units with currency", () => {
  const r = buildCouponParams({ code: "FIVE", amount_off: 5, currency: "USD" });
  assert.deepEqual(r.coupon, { duration: "once", amount_off: 500, currency: "usd" });
});

test("min order + max uses + expiry flow into coupon/promo", () => {
  const r = buildCouponParams({ code: "B2B", percent_off: 15, minimum_amount: 200, max_redemptions: 3, expires_at: "2026-12-31" });
  assert.equal(r.coupon.max_redemptions, 3);
  assert.equal(typeof r.coupon.redeem_by, "number");
  assert.equal(r.promo.max_redemptions, 3);
  assert.deepEqual(r.promo.restrictions, { minimum_amount: 20000, minimum_amount_currency: "usd" });
});

test("rejects bad code, no discount, out-of-range percent, negative amount", () => {
  assert.equal(buildCouponParams({ code: "a", percent_off: 10 }).error, "invalid_code");
  assert.equal(buildCouponParams({ code: "GOOD" }).error, "discount_required");
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: 150 }).error, "invalid_percent");
  assert.equal(buildCouponParams({ code: "GOOD", amount_off: -1 }).error, "invalid_amount");
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: 10, max_redemptions: 0 }).error, "invalid_max_redemptions");
});
