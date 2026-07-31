import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLIC_PRICE_TIERS,
  normalizePricingUpdate,
  publicPricingPayload,
} from "../functions/_lib/pricing.js";
import { renderMarkdown } from "../js/md.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("pricing update contract validates variant, service, and program writes", () => {
  assert.deepEqual(
    normalizePricingUpdate({
      resource: "variant",
      vsku: " VK-HCR-1G ",
      tiers: { retail: "23.79", hvac: "27.19", wholesale: "" },
    }),
    {
      resource: "variant",
      vsku: "VK-HCR-1G",
      tiers: { retail: 23.79, hvac: 27.19, wholesale: null },
    },
  );
  assert.deepEqual(
    normalizePricingUpdate({ resource: "service", sku: " MS-LAB-WTR-RAW ", public_price: "278.57" }),
    { resource: "service", sku: "MS-LAB-WTR-RAW", public_price: 278.57 },
  );
  assert.deepEqual(
    normalizePricingUpdate({
      resource: "program",
      slug: " Essentials ",
      price: "$385-715",
      annual: "$4.62K-8.58K / yr",
      expected_version: 7,
    }),
    {
      resource: "program",
      slug: "essentials",
      price: "$385-715",
      annual: "$4.62K-8.58K / yr",
      expected_version: 7,
    },
  );

  assert.throws(
    () => normalizePricingUpdate({ resource: "variant", vsku: "VK-HCR-1G", tiers: { retail: "-1" } }),
    /price_must_be_non_negative/,
  );
  assert.throws(
    () => normalizePricingUpdate({ resource: "service", sku: "MS-X", public_price: "not money" }),
    /price_must_be_numeric/,
  );
});

test("public pricing contract exposes public prices without wholesale account pricing", () => {
  assert.deepEqual(PUBLIC_PRICE_TIERS, ["retail", "hvac"]);
  const payload = publicPricingPayload({
    variants: [
      { vsku: "VK-HCR-1G", product_sku: "hcr", label: "1 gal jug", gallons: 1, price: 23.79 },
    ],
    tierCells: [
      { vsku: "VK-HCR-1G", tier: "retail", price: 23.79 },
      { vsku: "VK-HCR-1G", tier: "hvac", price: 27.19 },
      { vsku: "VK-HCR-1G", tier: "wholesale", price: 18 },
    ],
    services: [{ sku: "MS-A", name: "Audit", public_price: 100, active: true }],
    programs: [
      {
        slug: "essentials",
        title: "Essentials",
        payload: { name: "Essentials", price: "$385-715", annual: "$4.62K-8.58K / yr" },
        status: "published",
        version: 7,
      },
    ],
  });

  assert.deepEqual(payload.variants[0].tiers, { retail: 23.79, hvac: 27.19 });
  assert.equal("wholesale" in payload.variants[0].tiers, false);
  assert.equal(payload.services[0].public_price, 100);
  assert.equal(payload.pricing_tiers[0].price, "$385-715");
});

test("CMS price tokens render safe runtime bindings without numeric fallbacks", () => {
  const html = renderMarkdown("HCR lists at [[price:VK-HCR-2.5G|retail|per_gallon]].");
  assert.match(
    html,
    /data-price-vsku="VK-HCR-2\.5G" data-price-tier="retail" data-price-field="per_gallon"/,
  );
  assert.doesNotMatch(html, /\$23\.79/);
});

test("pricing routes and browser consumers use the live pricing contract", () => {
  const adminApi = read("functions/api/admin/variant-pricing.js");
  const productsApi = read("functions/api/admin/products.js");
  const publicApi = read("functions/api/pricing.js");
  const adminUi = read("js/admin/pricing.js");
  const runtime = read("js/main/pricing-data.js");
  const main = read("js/main.js");
  const services = read("js/main/service-catalog.js");
  const segments = read("js/main/segment-pricing.js");
  const snapshots = read("js/main/content-snapshots.js");

  assert.match(adminApi, /normalizePricingUpdate/);
  assert.match(adminApi, /set_variant_pricing/);
  assert.match(adminApi, /createContentRepository/);
  assert.match(productsApi, /price_cms_managed/);
  assert.doesNotMatch(productsApi, /workbook/i);
  assert.match(publicApi, /publicPricingPayload/);
  assert.match(adminUi, /data-price-save/);
  assert.match(adminUi, /method:\s*["']POST["']/);
  assert.match(runtime, /fetch\(["']\/api\/pricing["']/);
  assert.match(runtime, /data-price-vsku/);
  assert.match(main, /pricing-data\.js/);
  assert.match(services, /loadPricingData/);
  assert.match(segments, /loadPricingData/);
  assert.match(snapshots, /loadPricingData/);
});

test("every current public pricing surface binds to CMS runtime prices", () => {
  const resources = read("resources.html");
  const comparisons = [
    "vertkleen-hcr-vs-clr",
    "hcr-vs-rydlyme",
    "cr-hd-vs-simple-green",
    "lam3-vs-wet-forget",
    "beer-line-cleaner-cost-comparison",
  ];
  const blog = JSON.parse(read("data/content/blog.json")).blog_posts
    .filter((post) => comparisons.includes(post.slug));

  assert.match(resources, /data-variant-price-table[^>]*data-price-tier="hvac"/);
  assert.match(resources, /data-variant-price-table[^>]*data-price-tier="retail"/);
  for (const slug of comparisons) {
    const comparison = read(`comparisons/${slug}.html`);
    const post = read(`blog/${slug}.html`);
    assert.match(comparison, /data-price-vsku=/, `${slug} comparison needs live price bindings`);
    assert.match(post, /data-price-vsku=/, `${slug} blog needs live price bindings`);
  }
  assert.equal(blog.length, comparisons.length);
  assert.ok(blog.every((post) => post.body.includes("[[price:")));
});

test("bootstrap reseed preserves CMS runtime tier coverage", () => {
  const seed = read("tools/seed-products.mjs");
  const docs = read("docs/CATALOG_LIVE.md");

  assert.doesNotMatch(seed, /retail_price|public_price:\s*s\.public_price|syncRetailPriceTiers/);
  assert.doesNotMatch(seed, /\.from\(['"]price_tiers['"]\).*\.upsert/s);
  assert.match(docs, /Admin.*Pricing/);
  assert.match(docs, /metadata only/i);
});

test("tracked bootstrap and static pages contain no authoritative price values", () => {
  const catalog = JSON.parse(read("data/catalog.seed.json"));
  const segments = JSON.parse(read("data/segment-pricing.json"));
  const services = JSON.parse(read("data/services.json"));

  assert.ok(catalog.product_variants.every((row) => !("retail_price" in row)));
  assert.ok(catalog.product_variants.every((row) => !("price_per_gallon" in row)));
  assert.ok([...catalog.services, ...catalog.service_packages].every((row) => !("public_price" in row)));
  assert.ok(segments.segments.flatMap((segment) => segment.rows).every(
    (row) => !("price_per_unit" in row) && !("price_per_gallon" in row),
  ));
  assert.ok([...services.services, ...services.service_packages].every(
    (row) => !("public_price" in row),
  ));
  assert.equal(existsSync(new URL("../data/content/pricing.json", import.meta.url)), false);
  assert.doesNotMatch(read("programs.html"), /\$[0-9]/);
  assert.doesNotMatch(read("products/hcr.html"), /"@type":"Offer"/);
});
