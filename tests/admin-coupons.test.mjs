import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCouponParams,
  checkoutPromotion,
  normalizePromotionId,
  promotionListParams,
  storefrontPromotionCodesReady,
  storefrontPromotionSetAllowed,
} from "../functions/_lib/coupons.js";

const API_SRC = readFileSync(new URL("../functions/api/admin/coupons.js", import.meta.url), "utf8");
const UI_SRC = readFileSync(new URL("../js/admin/coupons.js", import.meta.url), "utf8");
const ADMIN_HTML = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const COUPON_UI = await import("../js/admin/coupons.js");

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

test("promotion-code listing accepts only bounded Stripe cursors", () => {
  assert.equal(normalizePromotionId(" promo_123AbC "), "promo_123AbC");
  assert.equal(normalizePromotionId("not-a-promo"), null);
  assert.deepEqual(
    promotionListParams("https://masest.co/api/admin/coupons"),
    { params: { limit: 100, expand: ["data.coupon"] } },
  );
  assert.deepEqual(
    promotionListParams("https://masest.co/api/admin/coupons?starting_after=promo_123AbC"),
    {
      params: {
        limit: 100,
        expand: ["data.coupon"],
        starting_after: "promo_123AbC",
      },
    },
  );
  assert.deepEqual(
    promotionListParams("https://masest.co/api/admin/coupons?starting_after=not-a-promo"),
    { error: "invalid_cursor" },
  );
});

test("promotion-code list exposes and consumes Stripe cursor pagination", () => {
  assert.match(API_SRC, /has_more/);
  assert.match(API_SRC, /next_cursor/);
  assert.match(UI_SRC, /data-load-more-coupons/);
  assert.match(UI_SRC, /starting_after=\$\{encodeURIComponent\(couponCursor\)\}/);
});

test("storefront enables promotion entry only for the exact VK5-only Stripe state", async () => {
  const vk5 = {
    id: "promo_VK5",
    code: "VK5",
    active: true,
    coupon: { percent_off: 5, amount_off: null, valid: true },
  };
  assert.equal(storefrontPromotionSetAllowed([vk5]), true);
  assert.equal(storefrontPromotionSetAllowed([]), false);
  assert.equal(storefrontPromotionSetAllowed([{ ...vk5, code: "VK10" }]), false);
  assert.equal(storefrontPromotionSetAllowed([vk5, { ...vk5, id: "promo_other" }]), false);
  assert.equal(storefrontPromotionSetAllowed([{ ...vk5, coupon: { percent_off: 10 } }]), false);
  assert.equal(storefrontPromotionSetAllowed([{ ...vk5, active: undefined }]), false);
  assert.equal(storefrontPromotionSetAllowed([{
    ...vk5,
    coupon: { percent_off: 5, amount_off: null },
  }]), false);

  assert.equal(await storefrontPromotionCodesReady({
    promotionCodes: {
      async list(params) {
        assert.deepEqual(params, { active: true, limit: 100, expand: ["data.coupon"] });
        return { data: [vk5], has_more: false };
      },
    },
  }), true);
  assert.equal(await storefrontPromotionCodesReady({
    promotionCodes: { async list() { return { data: [vk5], has_more: true }; } },
  }), false);
  assert.equal(await storefrontPromotionCodesReady({}), false);
});

test("promotion form keeps field names visible after values replace placeholders", () => {
  assert.match(ADMIN_HTML, /<form[^>]+class="adm-promo-form"/);
  for (const [id, label] of [
    ["cpCode", "Promo code"],
    ["cpDiscount", "Discount value"],
    ["cpMin", "Minimum order"],
    ["cpMax", "Max uses"],
    ["cpExpires", "Expires"],
  ]) {
    assert.match(
      ADMIN_HTML,
      new RegExp(`<label>${label}\\s*<input id="${id}"`),
      `${id} needs a persistent visible label`,
    );
  }
});

test("promotion form asks for one discount value after an explicit type choice", () => {
  assert.match(ADMIN_HTML, /<fieldset[^>]+class="adm-promo-type"/);
  assert.match(ADMIN_HTML, /name="discount_type"[^>]+value="percent"[^>]+checked/);
  assert.match(ADMIN_HTML, /name="discount_type"[^>]+value="amount"/);
  assert.doesNotMatch(ADMIN_HTML, /id="cpPercent"|id="cpAmount"/);
  assert.match(ADMIN_HTML, /<details[^>]+class="adm-promo-limits"/);
  assert.match(ADMIN_HTML, /<output id="cpPreview"/);
  assert.match(ADMIN_HTML, /id="cpHistoryHeading"/);
});

test("selected promotion type maps one value to exactly one Stripe discount field", () => {
  assert.equal(typeof COUPON_UI.buildPromotionDraft, "function");
  assert.deepEqual(
    COUPON_UI.buildPromotionDraft({
      code: " save10 ",
      discountType: "percent",
      discountValue: "10",
      minimumAmount: "100",
      maxRedemptions: "500",
      expiresAt: "2099-12-31",
    }),
    {
      code: "save10",
      percent_off: "10",
      amount_off: "",
      minimum_amount: "100",
      max_redemptions: "500",
      expires_at: "2099-12-31",
    },
  );
  assert.deepEqual(
    COUPON_UI.buildPromotionDraft({
      code: "TAKE25",
      discountType: "amount",
      discountValue: "25.00",
    }),
    {
      code: "TAKE25",
      percent_off: "",
      amount_off: "25.00",
      minimum_amount: "",
      max_redemptions: "",
      expires_at: "",
    },
  );
});

test("promotion preview explains offer and optional limits in customer language", () => {
  assert.equal(typeof COUPON_UI.promotionPreview, "function");
  assert.equal(
    COUPON_UI.promotionPreview({
      code: "save10",
      percent_off: "10",
      minimum_amount: "100",
      max_redemptions: "500",
      expires_at: "2099-12-31",
    }),
    "SAVE10 gives 10% off on orders of $100.00 or more. Limited to 500 uses. Expires Dec 31, 2099.",
  );
  assert.equal(
    COUPON_UI.promotionPreview({ code: "", percent_off: "" }),
    "Enter a promo code and discount to preview the customer offer.",
  );
});

test("promotion validation failures stay actionable instead of exposing raw API codes", () => {
  for (const code of [
    "invalid_code",
    "discount_required",
    "invalid_percent",
    "invalid_amount",
    "invalid_minimum_amount",
    "invalid_max_redemptions",
    "invalid_expires_at",
    "invalid_currency",
    "invalid_promo_id",
    "invalid_request_id",
    "stripe_error",
  ]) {
    assert.match(UI_SRC, new RegExp(`${code}:`), `${code} needs user-facing copy`);
  }
  assert.doesNotMatch(UI_SRC, /copy\s*\|\|\s*err\.data\?\.error/);
});

test("Checkout promotion attribution accepts Stripe expanded and string identities", () => {
  assert.deepEqual(
    checkoutPromotion({
      discounts: [{ promotion_code: { id: "promo_123AbC", code: " SAVE10 " } }],
    }),
    { id: "promo_123AbC", code: "SAVE10" },
  );
  assert.deepEqual(
    checkoutPromotion({ discounts: [{ promotion_code: "promo_String123" }] }),
    { id: "promo_String123", code: null },
  );
});

test("Checkout promotion attribution falls back to total breakdown and rejects unsafe data", () => {
  assert.deepEqual(
    checkoutPromotion({
      total_details: {
        breakdown: {
          discounts: [{
            discount: { promotion_code: { id: "promo_Fallback9", code: "B2B-15" } },
          }],
        },
      },
    }),
    { id: "promo_Fallback9", code: "B2B-15" },
  );
  assert.equal(checkoutPromotion({ discounts: [{ promotion_code: "not-a-promo" }] }), null);
  assert.equal(
    checkoutPromotion({ discounts: [{ promotion_code: `promo_${"x".repeat(241)}` }] }),
    null,
  );
  assert.deepEqual(
    checkoutPromotion({ discounts: [{ promotion_code: { id: "promo_Valid1", code: "BAD\nCODE" } }] }),
    { id: "promo_Valid1", code: null },
  );
  assert.equal(
    checkoutPromotion({
      discounts: [{ promotion_code: { id: { toString: () => "promo_Imposter" }, code: "FAKE" } }],
    }),
    null,
  );
});
