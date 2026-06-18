import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSite = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const catalog = () => JSON.parse(readSite("data/catalog.seed.json"));

test("canonical catalog carries latest chemical products and safe variant states", () => {
  const data = catalog();
  assert.equal(data.products.length, 20);
  assert.equal(data.product_variants.length, 100);

  const hcrTrial = data.product_variants.find((v) => v.sku === "VK-HCR-1");
  assert.equal(hcrTrial.product_slug, "hcr");
  assert.equal(hcrTrial.retail_price, "17.30");
  assert.equal(hcrTrial.active, true);
  assert.equal(hcrTrial.requires_quote, false);

  const watersafeTrial = data.product_variants.find((v) => v.sku === "VK-WS60-1");
  assert.equal(watersafeTrial.retail_price, null);
  assert.equal(watersafeTrial.active, false);
  assert.equal(watersafeTrial.requires_quote, true);

  const hcrTote = data.product_variants.find((v) => v.sku === "VK-HCR-275");
  assert.equal(hcrTote.retail_price, "2754.67");
  assert.equal(hcrTote.active, false);
  assert.equal(hcrTote.requires_quote, true);
});

test("controlled-launch policy: only priced small packs are buyable", () => {
  const data = catalog();
  const QUOTE_ONLY = new Set([
    "pg100", "pg50", "eg100", "eg50", "egu96", "eg5050", "watersafe60", "cr2", "sar",
  ]);

  // Quote-only products carry mode=quote; every other product is buy.
  for (const p of data.products) {
    assert.equal(p.mode, QUOTE_ONLY.has(p.slug) ? "quote" : "buy", `mode for ${p.slug}`);
  }

  // Nothing unfulfillable is buyable: every active+priced variant is a <55 gal small pack,
  // and no quote-only family ever has an active variant. This is the launch guardrail.
  const buyable = data.product_variants.filter((v) => v.active && v.retail_price != null);
  assert.equal(buyable.length, 33);
  for (const v of buyable) {
    assert.ok(Number(v.retail_price) > 0, `priced ${v.sku}`);
    assert.ok(Number(v.size_gal) < 55, `small pack ${v.sku}`);
    assert.ok(!QUOTE_ONLY.has(v.product_slug), `not quote-only ${v.sku}`);
  }

  // Glycol 5 gal is quote-only at launch (not buyable), per owner decision.
  const pg100_5 = data.product_variants.find((v) => v.sku === "VK-PG100-5");
  assert.equal(pg100_5.active, false);
  assert.equal(pg100_5.requires_quote, true);
});

test("canonical catalog carries quote-confirmed services and unique SKUs", () => {
  const data = catalog();
  assert.equal(data.services.length, 35);
  assert.equal(data.service_packages.length, 4);

  const allServiceSkus = [...data.services, ...data.service_packages].map((s) => s.sku);
  assert.equal(new Set(allServiceSkus).size, allServiceSkus.length);
  assert.ok(allServiceSkus.includes("MS-BID-SPEC-CREATION"));
  assert.ok(allServiceSkus.includes("MS-CONS-PARTICLE-ID"));

  const legionella = data.services.find((s) => s.sku === "MS-LAB-BIO-LEGIONELLA-FULL-CULTURE-SPECIE-ID");
  assert.equal(legionella.public_price, "421.43");
  assert.equal(legionella.mode, "quote_service");
});

test("Supabase seed SQL imports latest priced variants and omits active unpriced checkout", () => {
  const seed = readSite("supabase/variants_seed.sql");
  assert.match(seed, /'VK-HCR-1','hcr','1 gal',1,17\.30,true,1/);
  assert.match(seed, /'VK-PG100-5','pg100','5 gal',5,141,false,3/);
  assert.match(seed, /'VK-WS60-1','watersafe60','1 gal',1,null,false,1/);
  assert.match(seed, /'VK-HCR-275','hcr','275 gal tote',275,2754\.67,false,5/);
});

test("seed script imports products, variants, and services from canonical catalog", () => {
  const script = readFileSync(new URL("../../tools/seed-products.mjs", import.meta.url), "utf8");
  assert.match(script, /catalog\.seed\.json/);
  assert.match(script, /\['products', products, 'sku'\]/);
  assert.match(script, /\['product_variants', variants, 'vsku'\]/);
  assert.match(script, /\['services', services, 'sku'\]/);
});
