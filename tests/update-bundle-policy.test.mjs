import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateUpdateBundleReview } from "../tools/update-bundle-policy.mjs";
import { renderJobPlans } from "../tools/build-job-plans.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const review = JSON.parse(read("data/update-bundle-review.json"));
const updateSourceRoot = process.env.MASEST_UPDATE_SOURCE_ROOT
  || join(homedir(), "Desktop", "masest", "updates");
const updateSourceOptions = existsSync(updateSourceRoot)
  ? { sourceRoot: updateSourceRoot }
  : {};

test("five superseded bundle offers are retained for audit but held from publication", () => {
  const plans = validateUpdateBundleReview(review, updateSourceOptions);

  assert.deepEqual(plans, []);
  assert.equal(review.review_control.pricing_status, "held_for_repricing");
  assert.deepEqual(review.review_control.superseding_pricing_source, {
    file: "VertKleen_Website_Publish_List_2026_EXTERNAL.xlsx",
    version: "v4.1 EXTERNAL",
    sha256: "fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e",
  });
  assert.equal(review.bundle_concepts.length, 5);
  for (const plan of review.bundle_concepts) {
    assert.equal(plan.public_status, "held_for_repricing");
    assert.equal(plan.commerce_status, "inactive");
    assert.equal(plan.checkout_mode, "quote_required");
    assert.equal(plan.source_price_status, "superseded_by_v4.1_external");
    assert.equal(Object.hasOwn(plan, "approved_price_minor"), false);
    assert.ok(Number.isSafeInteger(plan.superseded_approved_price_minor));
    assert.deepEqual(plan.commercial_approval, {
      status: "superseded",
      approved_by_role: "Owner",
      approved_on: "2026-08-22",
      superseded_on: "2026-08-24",
    });
  }
});

test("held bundle policy rejects checkout, publication, price, provenance, and math drift", () => {
  const directCheckout = structuredClone(review);
  directCheckout.bundle_concepts[0].checkout_mode = "direct_cart";
  assert.throws(() => validateUpdateBundleReview(directCheckout), /checkout_mode_must_remain_quote_required/);

  const published = structuredClone(review);
  published.bundle_concepts[0].public_status = "published_bundle_offer";
  assert.throws(() => validateUpdateBundleReview(published), /held_public_status_invalid/);

  const currentPrice = structuredClone(review);
  currentPrice.bundle_concepts[0].approved_price_minor = 5400;
  assert.throws(() => validateUpdateBundleReview(currentPrice), /current_bundle_price_forbidden_while_held/);

  const sourceDrift = structuredClone(review);
  sourceDrift.review_control.superseding_pricing_source.sha256 = "0".repeat(64);
  assert.throws(() => validateUpdateBundleReview(sourceDrift), /superseding_pricing_source_mismatch/);

  const badMath = structuredClone(review);
  badMath.bundle_concepts[1].source_stated_savings_minor = 1;
  assert.throws(() => validateUpdateBundleReview(badMath), /source_price_math_mismatch/);

  const componentMath = structuredClone(review);
  componentMath.bundle_concepts[2].source_components[0].source_unit_price_minor += 1;
  assert.throws(() => validateUpdateBundleReview(componentMath), /component_price_math_mismatch/);
});

test("held bundles render no public price, savings, SKU, or order action", () => {
  assert.equal(renderJobPlans(review), "");
});

test("products page keeps generation markers but publishes no superseded bundle offers", () => {
  const html = read("products.html");
  assert.match(html, /<!-- job-plans:auto -->/);
  assert.match(html, /<!-- \/job-plans:auto -->/);
  const section = html.match(/<!-- job-plans:auto -->([\s\S]*?)<!-- \/job-plans:auto -->/)?.[1] || "";
  assert.doesNotMatch(section, /data-job-plan=|data-bundle-price-minor=|VK-BND-|Order this kit|Save \d+%/);
  assert.doesNotMatch(section, /\n[ \t]+\n/, "held section must not generate whitespace-only lines");
});
