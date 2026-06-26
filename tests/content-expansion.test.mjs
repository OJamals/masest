import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  contentPayloadFields,
  normalizeStructuredPayload,
} from "../js/content-types.js";

const root = new URL("..", import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("content export writes all non-commerce CMS snapshot groups", () => {
  const outDir = mkdtempSync(join(tmpdir(), "masest-content-"));
  const entries = [
    {
      type: "service",
      slug: "water-analysis",
      title: "Water analysis",
      status: "published",
      locale: "en",
      payload: { sku: "MS-LAB-WATER", category: "Lab", unit: "sample", public_price: 125, active: true },
      seo: {},
    },
    {
      type: "proof_card",
      slug: "brewery-cip",
      title: "Brewery CIP",
      status: "published",
      locale: "en",
      payload: { eyebrow: "Food", result: "Matched legacy CIP sequence", chips: ["CR", "HCR"] },
      seo: {},
    },
    {
      type: "resource_card",
      slug: "sds-requests",
      title: "SDS requests",
      status: "published",
      locale: "en",
      payload: { href: "resources.html#sds", description: "Request current safety documents." },
      seo: {},
    },
    {
      type: "industry_card",
      slug: "cold-storage",
      title: "Cold storage",
      status: "published",
      locale: "en",
      payload: { href: "industries/distribution-cold-storage", summary: "Refrigeration maintenance proof." },
      seo: {},
    },
    {
      type: "faq_block",
      slug: "quote-timing",
      title: "Quote timing",
      status: "published",
      locale: "en",
      payload: { question: "How fast are quotes returned?", answer: "Most requests receive a reply within one business day." },
      seo: {},
    },
  ];

  try {
    execFileSync(process.execPath, ["tools/build-content.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        CONTENT_EXPORT_SOURCE: JSON.stringify(entries),
        CONTENT_EXPORT_OUT_DIR: outDir,
      },
      stdio: "pipe",
    });

    const services = readJson(join(outDir, "services.json"));
    assert.equal(services.services[0].name, "Water analysis");
    assert.equal(services.services[0].sku, "MS-LAB-WATER");

    assert.equal(readJson(join(outDir, "proof.json")).proof_cards[0].slug, "brewery-cip");
    assert.equal(readJson(join(outDir, "resources.json")).resource_cards[0].href, "resources.html#sds");
    assert.equal(readJson(join(outDir, "industries.json")).industry_cards[0].title, "Cold storage");
    assert.equal(readJson(join(outDir, "faqs.json")).faq_blocks[0].question, "How fast are quotes returned?");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("admin CMS editor exposes structured fields for each content type", () => {
  const serviceFields = contentPayloadFields("service").map((field) => field.key);
  assert.deepEqual(serviceFields, ["sku", "category", "unit", "public_price", "currency", "active", "summary"]);

  const proofFields = contentPayloadFields("proof_card").map((field) => field.key);
  assert.ok(proofFields.includes("result"));
  assert.ok(proofFields.includes("chips"));

  const pageMetaFields = contentPayloadFields("page_meta").map((field) => field.key);
  assert.deepEqual(pageMetaFields, ["page", "description", "og_image", "jsonld_type"]);
});

test("structured CMS editor fields normalize booleans, numbers, and lists", () => {
  assert.deepEqual(
    normalizeStructuredPayload("service", {
      sku: " MS-LAB-WATER ",
      category: "Lab",
      unit: "sample",
      public_price: "125.50",
      currency: "usd",
      active: "on",
      summary: "",
    }),
    {
      sku: "MS-LAB-WATER",
      category: "Lab",
      unit: "sample",
      public_price: 125.5,
      currency: "usd",
      active: true,
    },
  );

  assert.deepEqual(
    normalizeStructuredPayload("proof_card", {
      chips: "CR, HCR\nCIP",
      result: "Matched legacy CIP sequence",
    }),
    {
      chips: ["CR", "HCR", "CIP"],
      result: "Matched legacy CIP sequence",
    },
  );
});
