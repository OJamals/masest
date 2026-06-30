import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_TYPE_DEFINITIONS,
  contentPayloadFields,
  normalizeStructuredPayload,
  validateStructuredPayload,
  snapshotGroups,
} from "../js/content-types.js";

test("CMS type registry exposes every supported non-commerce type", () => {
  assert.deepEqual(Object.keys(CONTENT_TYPE_DEFINITIONS).sort(), [
    "faq_block",
    "industry_card",
    "industry_sector",
    "page_meta",
    "page_section",
    "pricing_tier",
    "proof_card",
    "resource_card",
    "service",
    "service_package",
  ]);
  assert.equal(CONTENT_TYPE_DEFINITIONS.product, undefined);
});

test("pricing_tier normalizes tier fields and enforces a required name", () => {
  assert.deepEqual(
    normalizeStructuredPayload("pricing_tier", {
      badge: " Silver · Most chosen ",
      name: " Standard ",
      price: "$900-1,800",
      price_unit: " / mo",
      features: "CR\nNeutral, Descaler",
      featured: "on",
      sort_order: "2",
      active: "true",
      chips: "should not survive",
    }),
    {
      badge: "Silver · Most chosen",
      name: "Standard",
      price: "$900-1,800",
      price_unit: "/ mo",
      features: ["CR", "Neutral", "Descaler"],
      featured: true,
      sort_order: 2,
      active: true,
    },
  );
  assert.deepEqual(validateStructuredPayload("pricing_tier", { badge: "Bronze" }), {
    ok: false,
    error: "name_required",
  });
  assert.deepEqual(validateStructuredPayload("pricing_tier", { name: "Essentials", href: "javascript:alert(1)" }), {
    ok: false,
    error: "href_invalid_url",
  });
});

test("registry normalizes type-specific structured payloads", () => {
  assert.deepEqual(
    normalizeStructuredPayload("service", {
      sku: " MS-LAB-WATER ",
      category: "Lab",
      public_price: "130.25",
      active: "on",
      chips: "should not survive",
    }),
    {
      sku: "MS-LAB-WATER",
      category: "Lab",
      public_price: 130.25,
      active: true,
    },
  );
});

test("registry validates required fields and URL/image fields", () => {
  assert.deepEqual(validateStructuredPayload("resource_card", { href: "javascript:alert(1)" }), {
    ok: false,
    error: "href_invalid_url",
  });
  assert.deepEqual(validateStructuredPayload("faq_block", { question: "What is NET?", answer: "Invoice terms." }), {
    ok: true,
    payload: { question: "What is NET?", answer: "Invoice terms." },
  });
});

test("snapshotGroups returns every public export target", () => {
  assert.deepEqual(snapshotGroups().map((group) => group.file), [
    "services.json",
    "page-meta.json",
    "proof.json",
    "resources.json",
    "industries.json",
    "industry-sectors.json",
    "faqs.json",
    "page-sections.json",
    "pricing.json",
  ]);
  assert.ok(contentPayloadFields("proof_card").some((field) => field.key === "result"));
});
