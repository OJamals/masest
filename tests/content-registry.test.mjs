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
    "page_meta",
    "proof_card",
    "resource_card",
    "service",
    "service_package",
  ]);
  assert.equal(CONTENT_TYPE_DEFINITIONS.product, undefined);
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
    "faqs.json",
  ]);
  assert.ok(contentPayloadFields("proof_card").some((field) => field.key === "result"));
});
