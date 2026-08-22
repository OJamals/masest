import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUNDLE_REQUIRED_FIELDS,
  validateUpdateBundleReview,
} from "../tools/update-bundle-policy.mjs";
import { renderJobPlans } from "../tools/build-job-plans.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const review = JSON.parse(read("data/update-bundle-review.json"));
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;");
const updateSourceRoot = process.env.MASEST_UPDATE_SOURCE_ROOT
  || join(homedir(), "Desktop", "masest", "updates");
const updateSourceOptions = existsSync(updateSourceRoot)
  ? { sourceRoot: updateSourceRoot }
  : {};

test("five owner-approved bundle offers publish stable SKUs and current prices", () => {
  const plans = validateUpdateBundleReview(review, updateSourceOptions);

  assert.equal(plans.length, 5);
  assert.deepEqual(plans.map(({ name }) => name), [
    "Kitchen & Interior",
    "Bathroom Care",
    "Exterior & Curb Appeal",
    "HVAC & Plumbing",
    "Garage & Auto",
  ]);
  assert.deepEqual(plans.map(({ bundle_sku }) => bundle_sku), [
    "VK-BND-KITCHEN-4X1G",
    "VK-BND-BATHROOM-4X1G",
    "VK-BND-EXTERIOR-4X1G",
    "VK-BND-HVAC-4X1G",
    "VK-BND-GARAGE-4X1G",
  ]);
  for (const plan of plans) {
    assert.equal(plan.public_status, "published_bundle_offer");
    assert.equal(plan.commerce_status, "active_quote_offer");
    assert.equal(plan.checkout_mode, "quote_required");
    assert.equal(plan.source_price_status, "owner_approved_current_price");
    assert.equal(plan.approved_price_minor, plan.source_bundle_price_minor);
    assert.equal(plan.source_components.length, 4);
    assert.equal(plan.component_variant_skus.length, 4);
    assert.deepEqual(
      plan.source_components.map(({ variant_sku }) => variant_sku),
      plan.component_variant_skus,
    );
    assert.equal(
      plan.source_components.reduce((sum, component) => sum + component.source_unit_price_minor, 0),
      plan.source_separate_price_minor,
    );
    assert.deepEqual(plan.missing, []);
    for (const field of BUNDLE_REQUIRED_FIELDS) assert.ok(plan[field], `${plan.bundle_sku}: ${field}`);
    assert.deepEqual(plan.commercial_approval, {
      status: "owner_approved",
      approved_by_role: "Owner",
      approved_on: "2026-08-22",
    });
  }
});

test("bundle policy rejects direct checkout, stale price approval, source math, and variant drift", () => {
  const directCheckout = structuredClone(review);
  directCheckout.bundle_concepts[0].checkout_mode = "direct_cart";
  assert.throws(
    () => validateUpdateBundleReview(directCheckout),
    /checkout_mode_must_remain_quote_required/,
  );

  const staleApproval = structuredClone(review);
  staleApproval.bundle_concepts[0].approved_price_minor += 1;
  assert.throws(() => validateUpdateBundleReview(staleApproval), /approved_price_must_match_source/);

  const badMath = structuredClone(review);
  badMath.bundle_concepts[1].source_stated_savings_minor = 1;
  assert.throws(() => validateUpdateBundleReview(badMath), /source_price_math_mismatch/);

  const variantDrift = structuredClone(review);
  variantDrift.bundle_concepts[1].source_components[0].variant_sku = "VK-HCR-T16-1G";
  assert.throws(() => validateUpdateBundleReview(variantDrift), /component_variant_invalid/);

  const componentMath = structuredClone(review);
  componentMath.bundle_concepts[2].source_components[0].source_unit_price_minor += 1;
  assert.throws(() => validateUpdateBundleReview(componentMath), /component_price_math_mismatch/);

  const missingRule = structuredClone(review);
  missingRule.bundle_concepts[3].shipping_package_plan = "";
  assert.throws(() => validateUpdateBundleReview(missingRule), /shipping_package_plan_required/);

  const reviewDateDrift = structuredClone(review);
  reviewDateDrift.bundle_concepts[0].effective_date = "2026-08-23";
  assert.throws(
    () => validateUpdateBundleReview(reviewDateDrift),
    /effective_date_must_match_review/,
  );

  const approvalDateDrift = structuredClone(review);
  approvalDateDrift.bundle_concepts[0].commercial_approval.approved_on = "2026-08-21";
  assert.throws(
    () => validateUpdateBundleReview(approvalDateDrift),
    /commercial_approval_date_must_match_effective_date/,
  );
});

test("public bundle rendering exposes current price, savings, SKU, media, and quote context", () => {
  const html = renderJobPlans(review);

  assert.equal((html.match(/data-job-plan=/g) || []).length, 5);
  assert.equal((html.match(/data-bundle-price-minor=/g) || []).length, 5);
  assert.match(html, /\$54\.00/);
  assert.match(html, /Save 14%/);
  assert.match(html, /Ready-made cleaning kits/i);
  assert.match(html, /Shipping and tax are added to your quote/i);
  assert.match(html, /vertkleen-product-lineup\.webp/);
  assert.match(html, /vertkleen-hvac-hcr-5gal\.webp/);
  assert.doesNotMatch(html, /(?:\?|&amp;)interest=/);
  assert.doesNotMatch(html, /data-cart-add|add to cart/i);
  for (const plan of review.bundle_concepts) {
    assert.match(html, new RegExp(escapeHtml(plan.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(`data-job-plan="${plan.slug}"`));
    assert.match(html, new RegExp(`data-bundle-sku="${plan.bundle_sku}"`));
    assert.match(html, new RegExp(`product=${encodeURIComponent(plan.bundle_sku)}`));
    assert.match(html, new RegExp(`product=${encodeURIComponent(plan.bundle_sku)}[^"']*#quoteForm`));
    for (const sku of plan.component_variant_skus) assert.match(html, new RegExp(sku));
  }
});

test("products page receives generated priced bundle offers", () => {
  const html = read("products.html");
  assert.match(html, /<!-- job-plans:auto -->/);
  assert.match(html, /<!-- \/job-plans:auto -->/);
  assert.equal((html.match(/data-job-plan=/g) || []).length, 5);
  const section = html.match(/<!-- job-plans:auto -->([\s\S]*?)<!-- \/job-plans:auto -->/)?.[1] || "";
  assert.match(section, /\$54\.00/);
  assert.match(section, /VK-BND-KITCHEN-4X1G/);
  assert.match(section, /Order this kit/);
  assert.doesNotMatch(section, /data-cart-add|add to cart/i);
});
