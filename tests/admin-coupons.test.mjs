import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCouponParams } from "../functions/_lib/coupons.js";

const API_SRC = readFileSync(new URL("../functions/api/admin/coupons.js", import.meta.url), "utf8");
const UI_SRC = readFileSync(new URL("../js/admin/coupons.js", import.meta.url), "utf8");

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
  const r = buildCouponParams({ code: "B2B", percent_off: 15, minimum_amount: 200, max_redemptions: 3, expires_at: "2099-12-31" });
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

test("minimum_amount of 0 means no minimum (omitted — Stripe rejects a 0 minimum)", () => {
  const r = buildCouponParams({ code: "GOOD", percent_off: 10, minimum_amount: 0 });
  assert.equal(r.promo.restrictions, undefined);
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: 10, minimum_amount: -5 }).error, "invalid_minimum_amount");
});

test("rejects ambiguous and sub-cent fixed discounts", () => {
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: 10, amount_off: 5 }).error, "ambiguous_discount");
  assert.equal(buildCouponParams({ code: "GOOD", amount_off: "0.001" }).error, "invalid_amount");
  assert.equal(buildCouponParams({ code: "GOOD", amount_off: "0.00" }).error, "invalid_amount");
  assert.equal(buildCouponParams({ code: "GOOD", amount_off: "5.00", currency: "US" }).error, "invalid_currency");
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: 10, minimum_amount: "5.001" }).error, "invalid_minimum_amount");
});

test("expiry is future-only and a date remains valid through its UTC day", () => {
  const nowSeconds = Date.parse("2026-08-20T12:00:00Z") / 1000;
  assert.equal(
    buildCouponParams({ code: "GOOD", percent_off: 10, expires_at: "2026-08-19" }, { nowSeconds }).error,
    "invalid_expires_at",
  );
  const result = buildCouponParams(
    { code: "GOOD", percent_off: 10, expires_at: "2026-08-20" },
    { nowSeconds },
  );
  assert.equal(result.coupon.redeem_by, Date.parse("2026-08-20T23:59:59Z") / 1000);
  assert.equal(result.promo.expires_at, result.coupon.redeem_by);
  assert.equal(
    buildCouponParams({ code: "GOOD", percent_off: 10, expires_at: "2099-02-30" }, { nowSeconds }).error,
    "invalid_expires_at",
  );
});

test("percent and redemption limits use Stripe-safe exact numeric shapes", () => {
  assert.equal(buildCouponParams({ code: "GOOD", percent_off: "12.345" }).error, "invalid_percent");
  assert.equal(
    buildCouponParams({ code: "GOOD", percent_off: "10", max_redemptions: "1e2" }).error,
    "invalid_max_redemptions",
  );
});

test("promotion mutations are bounded, finance-gated, and expose stable provider errors", () => {
  assert.match(API_SRC, /staffCan\(\s*role\s*,\s*['"]promotion\.write['"]\s*\)/);
  assert.match(API_SRC, /readBoundedJson\(\s*request\s*,\s*BODY_LIMIT\s*\)/);
  assert.match(API_SRC, /RequestBodyTooLargeError/);
  assert.doesNotMatch(API_SRC, /stripe_error['"][^}]*detail:/s);
});

test("promotion creation retries use one browser identity across both Stripe writes", () => {
  assert.match(API_SRC, /request_id/);
  assert.match(API_SRC, /idempotencyKey:\s*`promotion-coupon:\$\{requestId\}`/);
  assert.match(API_SRC, /idempotencyKey:\s*`promotion-code:\$\{requestId\}`/);
  assert.match(UI_SRC, /crypto\.randomUUID\(\)/);
  assert.match(UI_SRC, /body\.request_id\s*=\s*couponCreateIdentity\.requestId/);
});
