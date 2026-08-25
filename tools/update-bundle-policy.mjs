import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REVIEW_URL = new URL("../data/update-bundle-review.json", import.meta.url);
const CATALOG_URL = new URL("../data/catalog.seed.json", import.meta.url);
const PRICING_PUBLICATION_URL = new URL("../data/vertkleen-website-publish-2026-v4.1.json", import.meta.url);
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[\\\0])[\s\S]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_STATUS = "approved_commercial_source";
const PUBLIC_STATUS = "published_bundle_offer";
const COMMERCE_STATUS = "active_quote_offer";
const SOURCE_PRICE_STATUS = "owner_approved_current_price";
const CHECKOUT_MODE = "quote_required";
const MAPPING_STATUS = "exact_catalog_product";
const ACTIVE_PRICING_STATUS = "approved_current";
const HELD_PRICING_STATUS = "held_for_repricing";
const FORBIDDEN_COMMERCE_FIELDS = [
  "active",
  "public_visible",
  "stripe_price_id",
  "checkout_url",
  "inventory_quantity",
  "variants",
];

export const BUNDLE_REQUIRED_FIELDS = Object.freeze([
  "fulfillment_model",
  "bundle_sku",
  "approved_price_minor",
  "effective_date",
  "inventory_reservation_rule",
  "shipping_package_plan",
  "discount_stacking_rule",
  "tax_configuration",
  "commercial_approval",
]);

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`update_bundle:${field}_required`);
  }
  return value.trim();
};

const validateRelativePath = (value, field) => {
  const path = requiredText(value, field);
  if (!SAFE_PATH.test(path)) throw new Error(`update_bundle:${field}_unsafe`);
  return path;
};

const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const verifySource = (sourceRoot, relativePath, expectedHash, sourceId) => {
  const path = join(sourceRoot, relativePath);
  if (!existsSync(path)) throw new Error(`update_bundle:${sourceId}:source_missing:${relativePath}`);
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`update_bundle:${sourceId}:source_symlink_refused:${relativePath}`);
  }
  if (hashFile(path) !== expectedHash) {
    throw new Error(`update_bundle:${sourceId}:source_hash_changed:${relativePath}`);
  }
};

const catalogRecords = () => {
  const catalog = JSON.parse(readFileSync(CATALOG_URL, "utf8"));
  if (
    !Array.isArray(catalog.products)
    || catalog.products.length < 1
    || !Array.isArray(catalog.product_variants)
    || catalog.product_variants.length < 1
  ) {
    throw new Error("update_bundle:catalog_products_missing");
  }
  return {
    slugs: new Set(catalog.products.map(({ slug }) => slug)),
    variants: new Map(catalog.product_variants.map((variant) => [variant.sku, variant])),
  };
};

const validateMoney = (value, field, conceptId) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`update_bundle:${conceptId}:${field}_invalid`);
  }
};

function validateHeldBundleReview(review, sourceIds) {
  const control = review.review_control;
  const publication = JSON.parse(readFileSync(PRICING_PUBLICATION_URL, "utf8"));
  const superseding = control.superseding_pricing_source;
  if (
    superseding?.file !== publication.source?.file
    || superseding?.version !== publication.source?.version
    || superseding?.sha256 !== publication.source?.sha256
  ) {
    throw new Error("update_bundle:superseding_pricing_source_mismatch");
  }
  if (publication.policy?.online_promotion?.code !== "VK5" || publication.policy?.online_promotion?.percent_off !== 5) {
    throw new Error("update_bundle:superseding_promotion_policy_mismatch");
  }

  const conceptIds = new Set();
  const conceptSlugs = new Set();
  const bundleSkus = new Set();
  for (const [index, concept] of review.bundle_concepts.entries()) {
    const conceptId = requiredText(concept?.concept_id, `bundle_concepts.${index}.concept_id`);
    const slug = requiredText(concept.slug, `${conceptId}.slug`);
    const bundleSku = requiredText(concept.bundle_sku, `${conceptId}.bundle_sku`);
    if (!/^MAS-UPD-BUNDLE-\d{3}$/.test(conceptId) || conceptIds.has(conceptId)) {
      throw new Error(`update_bundle:${conceptId}:concept_id_invalid_or_duplicate`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || conceptSlugs.has(slug)) {
      throw new Error(`update_bundle:${conceptId}:slug_invalid_or_duplicate`);
    }
    if (!/^VK-BND-[A-Z0-9]+(?:-[A-Z0-9]+)*-4X1G$/.test(bundleSku) || bundleSkus.has(bundleSku)) {
      throw new Error(`update_bundle:${conceptId}:bundle_sku_invalid_or_duplicate`);
    }
    requiredText(concept.name, `${conceptId}.name`);
    requiredText(concept.public_summary, `${conceptId}.public_summary`);
    if (concept.public_status !== HELD_PRICING_STATUS) {
      throw new Error(`update_bundle:${conceptId}:held_public_status_invalid`);
    }
    if (concept.commerce_status !== "inactive") {
      throw new Error(`update_bundle:${conceptId}:held_commerce_status_invalid`);
    }
    if (concept.checkout_mode !== CHECKOUT_MODE) {
      throw new Error(`update_bundle:${conceptId}:checkout_mode_must_remain_quote_required`);
    }
    if (concept.source_price_status !== "superseded_by_v4.1_external") {
      throw new Error(`update_bundle:${conceptId}:held_source_price_status_invalid`);
    }
    if (Object.hasOwn(concept, "approved_price_minor") || Object.hasOwn(concept, "current_approved_price_minor")) {
      throw new Error(`update_bundle:${conceptId}:current_bundle_price_forbidden_while_held`);
    }
    validateMoney(concept.superseded_approved_price_minor, "superseded_approved_price_minor", conceptId);
    validateMoney(concept.source_bundle_price_minor, "source_bundle_price_minor", conceptId);
    validateMoney(concept.source_separate_price_minor, "source_separate_price_minor", conceptId);
    validateMoney(concept.source_stated_savings_minor, "source_stated_savings_minor", conceptId);
    if (concept.source_separate_price_minor - concept.source_bundle_price_minor !== concept.source_stated_savings_minor) {
      throw new Error(`update_bundle:${conceptId}:source_price_math_mismatch`);
    }
    if (
      concept.commercial_approval?.status !== "superseded"
      || concept.commercial_approval?.approved_by_role !== "Owner"
      || concept.commercial_approval?.superseded_on !== control.effective_date
    ) {
      throw new Error(`update_bundle:${conceptId}:superseded_approval_invalid`);
    }
    if (
      !Array.isArray(concept.source_document_ids)
      || concept.source_document_ids.length < 1
      || concept.source_document_ids.some((sourceId) => !sourceIds.has(sourceId))
    ) {
      throw new Error(`update_bundle:${conceptId}:source_document_reference_invalid`);
    }
    if (
      !Array.isArray(concept.component_variant_skus)
      || concept.component_variant_skus.length !== 4
      || new Set(concept.component_variant_skus).size !== 4
      || !Array.isArray(concept.source_components)
      || concept.source_components.length !== 4
    ) {
      throw new Error(`update_bundle:${conceptId}:historical_components_invalid`);
    }
    const sourceTotal = concept.source_components.reduce((sum, component) => {
      validateMoney(component.source_unit_price_minor, "source_unit_price_minor", conceptId);
      return sum + component.source_unit_price_minor;
    }, 0);
    if (sourceTotal !== concept.source_separate_price_minor) {
      throw new Error(`update_bundle:${conceptId}:component_price_math_mismatch`);
    }
    conceptIds.add(conceptId);
    conceptSlugs.add(slug);
    bundleSkus.add(bundleSku);
  }
  return [];
}

export function validateUpdateBundleReview(review, { sourceRoot } = {}) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new Error("update_bundle:review_object_required");
  }

  const control = review.review_control;
  requiredText(control?.owner, "review_control.owner");
  requiredText(control?.revision, "review_control.revision");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(control?.effective_date || "")) {
    throw new Error("update_bundle:review_control.effective_date_invalid");
  }
  requiredText(control?.source_root_ref, "review_control.source_root_ref");
  requiredText(control?.public_rule, "review_control.public_rule");
  if (JSON.stringify(control?.required_commercial_fields) !== JSON.stringify(BUNDLE_REQUIRED_FIELDS)) {
    throw new Error("update_bundle:review_control.required_commercial_fields_mismatch");
  }

  if (!Array.isArray(review.source_documents) || review.source_documents.length < 1) {
    throw new Error("update_bundle:source_documents_missing");
  }
  const sourceIds = new Set();
  const sourcePaths = new Set();
  const sourceHashes = new Set();
  for (const [index, source] of review.source_documents.entries()) {
    const sourceId = requiredText(source?.source_id, `source_documents.${index}.source_id`);
    if (!/^MAS-UPD-BUNDLE-SRC-\d{3}$/.test(sourceId) || sourceIds.has(sourceId)) {
      throw new Error(`update_bundle:${sourceId}:source_id_invalid_or_duplicate`);
    }
    requiredText(source.title, `${sourceId}.title`);
    const sourcePath = validateRelativePath(source.source_path, `${sourceId}.source_path`);
    if (!/\.(?:pdf|xlsx)$/i.test(sourcePath) || sourcePaths.has(sourcePath)) {
      throw new Error(`update_bundle:${sourceId}:source_path_invalid_or_duplicate`);
    }
    if (!SHA256.test(source.source_sha256 || "") || sourceHashes.has(source.source_sha256)) {
      throw new Error(`update_bundle:${sourceId}:source_hash_invalid_or_duplicate`);
    }
    if (source.status !== SOURCE_STATUS || source.distribution !== "restricted") {
      throw new Error(`update_bundle:${sourceId}:source_approval_or_distribution_invalid`);
    }
    if (sourceRoot) verifySource(sourceRoot, sourcePath, source.source_sha256, sourceId);
    sourceIds.add(sourceId);
    sourcePaths.add(sourcePath);
    sourceHashes.add(source.source_sha256);
  }

  if (!Array.isArray(review.bundle_concepts) || review.bundle_concepts.length !== 5) {
    throw new Error("update_bundle:five_bundle_concepts_required");
  }
  if (control.pricing_status === HELD_PRICING_STATUS) {
    return validateHeldBundleReview(review, sourceIds);
  }
  if (control.pricing_status !== ACTIVE_PRICING_STATUS) {
    throw new Error("update_bundle:pricing_status_invalid");
  }
  const catalog = catalogRecords();
  const conceptIds = new Set();
  const conceptSlugs = new Set();
  const bundleSkus = new Set();
  for (const [index, concept] of review.bundle_concepts.entries()) {
    const conceptId = requiredText(concept?.concept_id, `bundle_concepts.${index}.concept_id`);
    if (!/^MAS-UPD-BUNDLE-\d{3}$/.test(conceptId) || conceptIds.has(conceptId)) {
      throw new Error(`update_bundle:${conceptId}:concept_id_invalid_or_duplicate`);
    }
    const slug = requiredText(concept.slug, `${conceptId}.slug`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || conceptSlugs.has(slug)) {
      throw new Error(`update_bundle:${conceptId}:slug_invalid_or_duplicate`);
    }
    requiredText(concept.name, `${conceptId}.name`);
    requiredText(concept.public_summary, `${conceptId}.public_summary`);
    if (concept.public_status !== PUBLIC_STATUS) {
      throw new Error(`update_bundle:${conceptId}:public_status_invalid`);
    }
    if (concept.commerce_status !== COMMERCE_STATUS) {
      throw new Error(`update_bundle:${conceptId}:commerce_status_invalid`);
    }
    if (concept.checkout_mode !== CHECKOUT_MODE) {
      throw new Error(`update_bundle:${conceptId}:checkout_mode_must_remain_quote_required`);
    }
    if (concept.source_price_status !== SOURCE_PRICE_STATUS || concept.source_currency !== "USD") {
      throw new Error(`update_bundle:${conceptId}:source_price_control_invalid`);
    }
    validateMoney(concept.source_bundle_price_minor, "source_bundle_price_minor", conceptId);
    validateMoney(concept.source_separate_price_minor, "source_separate_price_minor", conceptId);
    validateMoney(concept.source_stated_savings_minor, "source_stated_savings_minor", conceptId);
    if (
      concept.source_separate_price_minor - concept.source_bundle_price_minor
      !== concept.source_stated_savings_minor
    ) {
      throw new Error(`update_bundle:${conceptId}:source_price_math_mismatch`);
    }
    const bundleSku = requiredText(concept.bundle_sku, `${conceptId}.bundle_sku`);
    if (
      !/^VK-BND-[A-Z0-9]+(?:-[A-Z0-9]+)*-4X1G$/.test(bundleSku)
      || bundleSkus.has(bundleSku)
      || catalog.variants.has(bundleSku)
    ) {
      throw new Error(`update_bundle:${conceptId}:bundle_sku_invalid_or_duplicate`);
    }
    validateMoney(concept.approved_price_minor, "approved_price_minor", conceptId);
    if (concept.approved_price_minor !== concept.source_bundle_price_minor) {
      throw new Error(`update_bundle:${conceptId}:approved_price_must_match_source`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(concept.effective_date || "")) {
      throw new Error(`update_bundle:${conceptId}:effective_date_invalid`);
    }
    if (concept.effective_date !== control.effective_date) {
      throw new Error(`update_bundle:${conceptId}:effective_date_must_match_review`);
    }
    for (const field of BUNDLE_REQUIRED_FIELDS.filter((field) => field !== "commercial_approval")) {
      if (field === "approved_price_minor") continue;
      requiredText(concept[field], `${conceptId}.${field}`);
    }
    if (
      concept.commercial_approval?.status !== "owner_approved"
      || concept.commercial_approval?.approved_by_role !== "Owner"
      || !/^\d{4}-\d{2}-\d{2}$/.test(concept.commercial_approval?.approved_on || "")
    ) {
      throw new Error(`update_bundle:${conceptId}:commercial_approval_invalid`);
    }
    if (concept.commercial_approval.approved_on !== concept.effective_date) {
      throw new Error(`update_bundle:${conceptId}:commercial_approval_date_must_match_effective_date`);
    }
    if (
      !Array.isArray(concept.component_variant_skus)
      || concept.component_variant_skus.length !== 4
      || new Set(concept.component_variant_skus).size !== 4
    ) {
      throw new Error(`update_bundle:${conceptId}:four_component_variant_skus_required`);
    }
    if (!Array.isArray(concept.missing) || concept.missing.length !== 0) {
      throw new Error(`update_bundle:${conceptId}:missing_commercial_fields_must_be_empty`);
    }
    if (
      !Array.isArray(concept.source_document_ids)
      || concept.source_document_ids.length < 1
      || concept.source_document_ids.some((sourceId) => !sourceIds.has(sourceId))
    ) {
      throw new Error(`update_bundle:${conceptId}:source_document_reference_invalid`);
    }
    if (FORBIDDEN_COMMERCE_FIELDS.some((field) => Object.hasOwn(concept, field))) {
      throw new Error(`update_bundle:${conceptId}:active_commerce_field_forbidden`);
    }
    if (!Array.isArray(concept.source_components) || concept.source_components.length !== 4) {
      throw new Error(`update_bundle:${conceptId}:four_source_components_required`);
    }
    const componentNames = new Set();
    let sourceUnitPriceTotal = 0;
    for (const [componentIndex, component] of concept.source_components.entries()) {
      const sourceName = requiredText(
        component?.source_name,
        `${conceptId}.source_components.${componentIndex}.source_name`,
      );
      if (componentNames.has(sourceName)) {
        throw new Error(`update_bundle:${conceptId}:source_component_duplicate:${sourceName}`);
      }
      if (component.mapping_status !== MAPPING_STATUS) {
        throw new Error(`update_bundle:${conceptId}:${sourceName}:mapping_status_invalid`);
      }
      if (!catalog.slugs.has(component.catalog_slug) || "candidate_catalog_slugs" in component) {
        throw new Error(`update_bundle:${conceptId}:${sourceName}:exact_mapping_invalid`);
      }
      const expectedSku = concept.component_variant_skus[componentIndex];
      const variant = catalog.variants.get(component.variant_sku);
      if (
        component.variant_sku !== expectedSku
        || !variant
        || variant.product_slug !== component.catalog_slug
        || variant.size_gal !== 1
        || variant.container_type !== "jug"
        || variant.active !== true
      ) {
        throw new Error(`update_bundle:${conceptId}:${sourceName}:component_variant_invalid`);
      }
      validateMoney(component.source_unit_price_minor, "source_unit_price_minor", conceptId);
      sourceUnitPriceTotal += component.source_unit_price_minor;
      componentNames.add(sourceName);
    }
    if (sourceUnitPriceTotal !== concept.source_separate_price_minor) {
      throw new Error(`update_bundle:${conceptId}:component_price_math_mismatch`);
    }
    conceptIds.add(conceptId);
    conceptSlugs.add(slug);
    bundleSkus.add(bundleSku);
  }

  return review.bundle_concepts;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const review = JSON.parse(readFileSync(REVIEW_URL, "utf8"));
  const sourceRoot = process.env.MASEST_UPDATE_SOURCE_ROOT
    || join(homedir(), "Desktop", "masest", "updates");
  const availableRoot = existsSync(sourceRoot) ? sourceRoot : undefined;
  const concepts = validateUpdateBundleReview(review, { sourceRoot: availableRoot });
  console.log(
    `update-bundle-policy: ${concepts.length} current priced bundle quote offers; ${availableRoot ? "source bytes verified" : "schema verified (source root unavailable)"}`,
  );
}
