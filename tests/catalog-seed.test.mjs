import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSite = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const catalog = () => JSON.parse(readSite("data/catalog.seed.json"));
const drumPricing = () => JSON.parse(readSite("data/drum-pricing.json"));
const CONFIRMED_WORKBOOK_PRODUCTS = [
  "cr",
  "cr2",
  "hcr",
  "hcr-t16",
  "descaler",
  "cr-hd",
  "cr-hd-low-foam",
  "neutral",
  "multiwash",
  "lam3",
  "purgo",
  "alumibrite",
  "torque",
  "sar",
  "watersafe60",
];

test("canonical catalog carries the confirmed July 2026 workbook products and variants", () => {
  const data = catalog();
  assert.equal(data.products.length, 15);
  assert.equal(data.product_variants.length, 66);
  assert.deepEqual(data.products.map((product) => product.slug), CONFIRMED_WORKBOOK_PRODUCTS);

  const hcrTrial = data.product_variants.find((v) => v.sku === "VK-HCR-1G");
  assert.equal(hcrTrial.product_slug, "hcr");
  assert.equal(hcrTrial.retail_price, "21.63");
  assert.equal(hcrTrial.active, true);
  assert.equal(hcrTrial.requires_quote, false);

  const watersafeTrial = data.product_variants.find((v) => v.sku === "VK-WS60-1G");
  assert.equal(watersafeTrial.retail_price, "16.88");
  assert.equal(watersafeTrial.active, true);
  assert.equal(watersafeTrial.requires_quote, false);

  const hcrTote = data.product_variants.find((v) => v.sku === "VK-HCR-275G");
  assert.equal(hcrTote.retail_price, "3443.34");
  assert.equal(hcrTote.active, false);
  assert.equal(hcrTote.requires_quote, true);

  const hcrT16Jug = data.product_variants.find((v) => v.sku === "VK-HCR-T16-1G");
  assert.equal(hcrT16Jug.retail_price, "21.71");
  assert.equal(hcrT16Jug.active, true);
  assert.equal(hcrT16Jug.requires_quote, false);

  const descalerTrial = data.product_variants.find((v) => v.sku === "VK-DESC-1G");
  assert.equal(descalerTrial.retail_price, "15.03");
  assert.equal(descalerTrial.active, true);
  assert.equal(descalerTrial.requires_quote, false);
});

test("product catalog policy: confirmed small packs are buyable and drums/totes quote-routed", () => {
  const data = catalog();

  for (const product of data.products) {
    const small = data.product_variants.filter((v) => (
      v.product_slug === product.slug && [1, 2.5, 5].includes(Number(v.size_gal))
    ));
    const oneGal = small.find((v) => Number(v.size_gal) === 1);
    assert.ok(oneGal, `${product.slug} should expose the NEW 1 gal jug size`);
    assert.equal(oneGal.active, true, `${product.slug} 1 gal jug should be active`);
    assert.equal(oneGal.requires_quote, false, `${product.slug} 1 gal jug should be buyable`);
    assert.ok(small.length > 0, `${product.slug} should have small-pack variants`);
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
  assert.match(seed, /'VK-HCR-1G','hcr','1 gal jug',1,21\.63,true,1/);
  assert.match(seed, /'VK-WS60-1G','watersafe60','1 gal jug',1,16\.88,true,1/);
  assert.match(seed, /'VK-CR2-1G','cr2','1 gal jug',1,18\.25,true,1/);
  assert.match(seed, /'VK-SAR-1G','sar','1 gal jug',1,15\.13,true,1/);
  assert.doesNotMatch(seed, /VK-PG100|VK-EG5050/);
  assert.match(seed, /'VK-HCR-275G','hcr','275 gal tote',275,3443\.34,false,5/);
});

test("public drum pricing includes confirmed products while all bulk remains quote-routed", () => {
  const pricing = drumPricing();
  assert.equal(pricing.watersafe60[0].label, "55 gal drum");
  assert.equal(pricing.cr2[0].label, "55 gal drum");
  assert.equal(pricing.sar[0].label, "55 gal drum");
});

test("segment pricing uses current public workbook rows and quote footers", () => {
  const data = JSON.parse(readSite("data/segment-pricing.json"));
  assert.equal(
    data.volume_discount,
    "200+ jugs: 5% off · 1,000+ gallons (drums/totes): 5% off",
  );
  assert.equal(
    data.footer_note,
    "Prices valid six months from publication. Shipping and freight excluded — FOB Ex Plant, Merritt Island FL.",
  );

  const hvac = data.segments.find((segment) => segment.slug === "hvac-facilities");
  const row = (sku) => hvac.rows.find((item) => item.sku === sku);
  assert.equal(row("VK-HCR-2.5G").price_per_unit, "61.80");
  assert.equal(row("VK-CR-2.5G").price_per_unit, "55.05");
  assert.equal(row("VK-PRG-2.5G").price_per_unit, "53.73");
  assert.equal(row("VK-PRG-2.5G").price_per_gallon, "21.49");

  const resourcesHtml = readSite("resources.html");
  assert.doesNotMatch(resourcesHtml, /HCR \$43\.26|CR \$38\.53|CR HD \$23\.57|\$58\.61/);
  assert.doesNotMatch(resourcesHtml, /FOB ex-plant, Melbourne FL|FOB Melbourne, FL/);
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
  assert.equal(data.products.length, 15);
  assert.ok(!slugs.includes("crs"), "CRS needs owner confirmation before public ecommerce listing");
  assert.ok(!slugs.includes("dbnpa"), "DBNPA stays a program component, not canonical parent SKU");
  assert.ok(!slugs.includes("pg100"), "PG/EG glycol products are not in the confirmed July 2026 website price list");
  assert.ok(!slugs.includes("eg5050"), "PG/EG glycol products are not in the confirmed July 2026 website price list");
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
