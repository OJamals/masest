import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSite = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const catalog = () => JSON.parse(readSite("data/catalog.seed.json"));
const drumPricing = () => JSON.parse(readSite("data/drum-pricing.json"));
const QUOTE_REVIEW_PRODUCTS = new Set(["watersafe60", "cr2", "sar", "eg5050"]);

test("canonical catalog carries all chemical products and variants", () => {
  const data = catalog();
  assert.equal(data.products.length, 20);
  assert.equal(data.product_variants.length, 100);

  const hcrTrial = data.product_variants.find((v) => v.sku === "VK-HCR-1");
  assert.equal(hcrTrial.product_slug, "hcr");
  assert.equal(hcrTrial.retail_price, "17.30");
  assert.equal(hcrTrial.active, true);
  assert.equal(hcrTrial.requires_quote, false);

  const watersafeTrial = data.product_variants.find((v) => v.sku === "VK-WS60-1");
  assert.equal(watersafeTrial.retail_price, "11.26");
  assert.equal(watersafeTrial.active, false);
  assert.equal(watersafeTrial.requires_quote, true);

  const hcrTote = data.product_variants.find((v) => v.sku === "VK-HCR-275");
  assert.equal(hcrTote.retail_price, "2754.67");
  assert.equal(hcrTote.active, false);
  assert.equal(hcrTote.requires_quote, true);
});

test("product catalog policy: small packs respect buyable and quote-review readiness gates", () => {
  const data = catalog();

  for (const product of data.products) {
    const small = data.product_variants.filter((v) => (
      v.product_slug === product.slug && [1, 2.5, 5].includes(Number(v.size_gal))
    ));
    assert.ok(small.length > 0, `${product.slug} should have small-pack variants`);
    if (QUOTE_REVIEW_PRODUCTS.has(product.slug)) {
      assert.equal(product.mode, "quote", `${product.slug} should stay quote-first until proof is complete`);
      assert.ok(small.every((v) => v.active === false), `${product.slug} small packs should not be checkout-active`);
      assert.ok(small.every((v) => v.requires_quote === true), `${product.slug} small packs should require quote`);
      continue;
    }
    assert.equal(product.mode, "buy", `${product.slug} should be buyable in small packs`);
    assert.ok(small.every((v) => v.active === true), `${product.slug} small packs should be active`);
    assert.ok(small.every((v) => Number(v.retail_price) > 0), `${product.slug} small packs should be priced`);
    assert.ok(small.every((v) => v.requires_quote === false), `${product.slug} small packs should not require quote`);
  }

  const bulk = data.product_variants.filter((v) => Number(v.size_gal) >= 55);
  assert.ok(bulk.length > 0, "bulk variants should remain in catalog");
  assert.ok(bulk.every((v) => v.active === false), "bulk variants should not be checkout-active");
  assert.ok(bulk.every((v) => v.requires_quote === true), "bulk variants should require quote");
});

test("canonical catalog carries quote-confirmed services and unique SKUs", () => {
  const data = catalog();
  assert.equal(data.services.length, 35);
  assert.equal(data.service_packages.length, 4);

  const allServiceSkus = [...data.services, ...data.service_packages].map((s) => s.sku);
  assert.equal(allServiceSkus.length, new Set(allServiceSkus).size);
  assert.ok(allServiceSkus.includes("MS-BID-SPEC-CREATION"));
  assert.ok(allServiceSkus.includes("MS-CONS-PARTICLE-ID"));

  const legionella = data.services.find((s) => s.sku === "MS-LAB-BIO-LEGIONELLA-FULL-CULTURE-SPECIE-ID");
  assert.equal(legionella.public_price, "421.43");
  assert.equal(legionella.mode, "quote_service");
});

test("Supabase seed SQL imports buyable and quote-review variant state", () => {
  const seed = readSite("supabase/variants_seed.sql");
  assert.match(seed, /'VK-HCR-1','hcr','1 gal',1,17\.3,true,1/);
  assert.match(seed, /'VK-WS60-1','watersafe60','1 gal',1,11\.26,false,1/);
  assert.match(seed, /'VK-CR2-1','cr2','1 gal',1,[\d.]+,false,1/);
  assert.match(seed, /'VK-SAR-1','sar','1 gal',1,[\d.]+,false,1/);
  assert.match(seed, /'VK-EG5050-5','eg5050','5 gal',5,[\d.]+,false,3/);
  assert.match(seed, /'VK-PG100-5','pg100','5 gal',5,141,true,3/);
  assert.match(seed, /'VK-HCR-275','hcr','275 gal tote',275,2754\.67,false,5/);
});

test("public drum pricing excludes quote-review products", () => {
  const pricing = drumPricing();
  for (const slug of QUOTE_REVIEW_PRODUCTS) {
    assert.equal(pricing[slug], undefined, `${slug} should route bulk pricing through quote intake`);
  }
});

test("quote-review copy avoids certification certainty", () => {
  const watersafe = catalog().products.find((product) => product.slug === "watersafe60");
  assert.ok(watersafe, "WaterSafe60 catalog row should exist");
  assert.match(watersafe.description, /status reviewed by request/);
  assert.doesNotMatch(watersafe.description, /certified|files by request/i);
});

test("seed script imports products, variants, and services from canonical catalog", () => {
  const script = readFileSync(new URL("../tools/seed-products.mjs", import.meta.url), "utf8");
  assert.match(script, /catalog\.seed\.json/);
  assert.match(script, /\['products', products, 'sku'\]/);
  assert.match(script, /\['product_variants', variants, 'vsku'\]/);
  assert.match(script, /\['services', services, 'sku'\]/);
});

test("public catalog excludes non-canonical program aliases", () => {
  const data = catalog();
  const slugs = data.products.map((product) => product.slug);
  assert.equal(data.products.length, 20);
  assert.ok(!slugs.includes("crs"), "CRS needs owner confirmation before public ecommerce listing");
  assert.ok(!slugs.includes("dbnpa"), "DBNPA stays a program component, not canonical parent SKU");
});

test("site copy respects documentation claim guardrails", () => {
  const catalogJs = readSite("js/main/catalog-data.js");
  const productHtml = readSite("product.html");
  const productsHtml = readSite("products.html");
  const resourcesHtml = readSite("resources.html");
  const programsHtml = readSite("programs.html");
  const aboutHtml = readSite("about.html");
  const chromeJs = readSite("js/main/chrome.js");

  assert.doesNotMatch(catalogJs, /ids:\s*\[[^\]]*"crs"/, "CRS should not be in public replacement checker");
  assert.doesNotMatch(productHtml, /crs:\s*"descaler"/, "CRS should not inherit Descaler commerce pricing");
  assert.doesNotMatch(productsHtml, /Every product in purchasable catalog HMIS 0-0-0/);
  assert.doesNotMatch(resourcesHtml, /Boeing\/Airbus certified degreaser/);
  assert.doesNotMatch(catalogJs, /EPA-registered/);
  assert.doesNotMatch(programsHtml, /EPA-registered/);
  assert.doesNotMatch(productHtml, /EPA-registered/);
  assert.doesNotMatch(catalogJs, /Certified inhibitor chemistry|NSF\/ANSI 60 Certification/);
  assert.doesNotMatch(catalogJs, /Certificate files route/);
  assert.doesNotMatch(resourcesHtml, /NSF\/ANSI 60 certification/);
  assert.doesNotMatch(resourcesHtml, /Get SDS and certification files|certifications, and case files/);
  assert.doesNotMatch(chromeJs, /SDS-backed SKUs/);
  assert.doesNotMatch(aboutHtml, /registered to ISO 14064/);
});
