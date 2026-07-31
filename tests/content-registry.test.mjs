import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_TYPE_DEFINITIONS,
  browserContentDeliveries,
  contentDeliveryRegistry,
  contentPageOptionsFromSitemap,
  contentPayloadFields,
  ensureContentPageMount,
  normalizeContentPageKey,
  normalizeStructuredPayload,
  validateStructuredPayload,
  snapshotGroups,
  specializedContentDeliveries,
} from "../js/content-types.js";

test("CMS type registry exposes every supported content type", () => {
  assert.deepEqual(Object.keys(CONTENT_TYPE_DEFINITIONS).sort(), [
    "blog_post",
    "faq_block",
    "industry_sector",
    "page_meta",
    "page_section",
    "pricing_tier",
    "proof_card",
    "resource_card",
    "service",
    "service_package",
    "shipping_rate",
  ]);
  assert.equal(CONTENT_TYPE_DEFINITIONS.product, undefined);
  assert.equal(CONTENT_TYPE_DEFINITIONS.industry_card, undefined);
});

test("shipping rates stay server-side and validate CMS fields", () => {
  const definition = CONTENT_TYPE_DEFINITIONS.shipping_rate;
  assert.equal(definition.snapshot, undefined);
  assert.deepEqual(
    normalizeStructuredPayload("shipping_rate", {
      stripe_rate_id: " shr_ground ",
      active: "on",
      sort_order: "2",
    }),
    { stripe_rate_id: "shr_ground", active: true, sort_order: 2 },
  );
  assert.deepEqual(validateStructuredPayload("shipping_rate", { active: true }), {
    ok: false,
    error: "stripe_rate_id_required",
  });
  assert.deepEqual(validateStructuredPayload("shipping_rate", {
    stripe_rate_id: "price_not_shipping",
    active: true,
  }), {
    ok: false,
    error: "stripe_rate_id_invalid_format",
  });
  assert.equal(
    snapshotGroups().some((group) => group.types.some(({ type }) => type === "shipping_rate")),
    false,
  );
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

test("CMS page registry normalizes routes, lists sitemap pages, and mounts once", () => {
  assert.equal(normalizeContentPageKey("/"), "home");
  assert.equal(normalizeContentPageKey("https://masest.co/products/hcr.html?x=1"), "products/hcr");
  assert.equal(normalizeContentPageKey("../private"), "");
  assert.deepEqual(
    normalizeStructuredPayload("page_section", {
      page: "https://masest.co/industries/hvac-water.html",
      region: "body",
      headline: "Clean loops",
    }),
    { page: "industries/hvac-water", region: "body", headline: "Clean loops" },
  );
  const sitemap = "<loc>https://masest.co/</loc><loc>https://masest.co/products/hcr</loc><loc>https://masest.co/blog/post</loc>";
  assert.deepEqual(contentPageOptionsFromSitemap(sitemap), ["home", "products/hcr"]);
  const html = "<main><h1>Privacy</h1></main>";
  const mounted = ensureContentPageMount(html, "/privacy");
  assert.match(mounted, /data-cms-page="privacy"/);
  assert.equal(ensureContentPageMount(mounted, "/privacy"), mounted);
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
    "industry-sectors.json",
    "faqs.json",
    "page-sections.json",
    "blog.json",
  ]);
  const proofFields = contentPayloadFields("proof_card").map((field) => field.key);
  assert.ok(proofFields.includes("result"));
  assert.ok(proofFields.includes("narrative"));
  assert.ok(proofFields.includes("publication_scope"));
  assert.equal(proofFields.includes("href"), false);
});

test("delivery registry derives exporter, browser, and specialized generation policy", () => {
  assert.equal(contentDeliveryRegistry().length, 10);
  assert.deepEqual(browserContentDeliveries(), [
    { type: "proof_card", file: "proof.json", endpoint: null, key: "proof_cards", renderer: "proof_card" },
    { type: "resource_card", file: "resources.json", endpoint: null, key: "resource_cards", renderer: "resource_card" },
    { type: "industry_sector", file: "industry-sectors.json", endpoint: null, key: "industry_sectors", renderer: "industry_sector" },
    { type: "faq_block", file: "faqs.json", endpoint: null, key: "faq_blocks", renderer: "faq_block" },
    { type: "page_section", file: "page-sections.json", endpoint: null, key: "page_sections", renderer: "page_section" },
    { type: "pricing_tier", file: null, endpoint: "/api/pricing", key: "pricing_tiers", renderer: "pricing_tier" },
  ]);
  assert.deepEqual(specializedContentDeliveries(), [
    { type: "service", file: "services.json", key: "services", generator: "service_catalog" },
    { type: "service_package", file: "services.json", key: "service_packages", generator: "service_catalog" },
    { type: "page_meta", file: "page-meta.json", key: "page_meta", generator: "page_metadata" },
    { type: "blog_post", file: "blog.json", key: "blog_posts", generator: "blog_pages" },
  ]);
});

test("proof cards support published product records without source-file fields", () => {
  const complete = {
    result: "Visible field result.",
    narrative: "Short case narrative.",
    publication_scope: "Published result summary",
  };

  assert.deepEqual(validateStructuredPayload("proof_card", complete), {
    ok: true,
    payload: complete,
  });
  assert.deepEqual(
    validateStructuredPayload("proof_card", {
      ...complete,
      publication_scope: "Published product record",
    }),
    {
      ok: true,
      payload: {
        ...complete,
        publication_scope: "Published product record",
      },
    },
  );
  assert.deepEqual(
    validateStructuredPayload("proof_card", { ...complete, publication_scope: "" }),
    { ok: false, error: "publication_scope_required" },
  );
  for (const publication_scope of [
    "Owner-confirmed image",
    "Customer logo on file",
    "Internal trial history",
  ]) {
    assert.deepEqual(
      validateStructuredPayload("proof_card", { ...complete, publication_scope }),
      { ok: false, error: "publication_scope_invalid_option" },
    );
  }
});
