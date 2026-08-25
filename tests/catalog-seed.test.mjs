import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { CATALOG_ORDER } from "../js/main/catalog-data.js";

const readSite = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const catalog = () => JSON.parse(readSite("data/catalog.seed.json"));
const CATALOG_PRODUCTS = [
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
  "cr60",
];
const SERVICE_NAMES = [
  "Raw Water - Standard Analysis",
  "Tower Water - Standard + Bio Counts",
  "Chill Water - Standard + Bio Counts",
  "Closed Loop Water - Standard + Bio Counts",
  "Steam Boiler Water - Standard",
  "Pretreatment Water (Soft/Degas)",
  "Boiler Feed Water - Standard",
  "Polisher Water - Standard",
  "Steam Condensate - Standard",
  "Biological Counts (HPC/dip-slide)",
  "Legionella - Full Culture + Specie ID",
  "Legionella - PCR Pos/Neg",
  "Biological Identifications",
  "Corrosion Coupon Analysis (incl. photo)",
  "Pipe Analysis (Deposit + Measurements + Photos)",
  "Deposit Analysis - Standard",
  "Single Element Analysis (ICP or IC)",
  "Abbreviated Analysis (ICP or IC)",
  "Water Treatment Bid Specification Creation",
  "Water Treatment Bid Review",
  "Water Treatment Bid Interview",
  "Consulting Services (general)",
  "Equipment Inspections",
  "Ultrasonic / Borescope Testing",
  "Scanning Electron Microscope Testing",
  "Sprinkler System Testing",
  "Particle Size Analysis",
  "Particle Size Analysis + Particle ID",
  "On-Site Sample Collection (travel quoted)",
  "On-Site Sampling Fee (standard visit)",
  "Risk Assessment (ASHRAE 188)",
  "WMP Development (ASHRAE 188)",
  "Plan Certification",
  "Plan Renewal (annual)",
  "Monthly Dashboard Access",
];
const SERVICE_PACKAGE_NAMES = [
  "Initial Sampling Visit Package",
  "Water Management Plan Setup (annual)",
  "Quarterly Audit",
  "Yearly Recertification",
];

test("public catalog counts match the canonical product order", () => {
  const count = String(CATALOG_ORDER.length);
  const products = readSite("products.html");
  assert.match(
    products,
    new RegExp(`<span><b>${count}</b> products</span>`),
  );
  assert.match(products, new RegExp(`content="Shop ${count} VertKleen cleaners`));
  assert.match(
    readSite("index.html"),
    new RegExp(`<div class="big">${count}</div><div class="lbl">Buyable VertKleen products</div>`),
  );
});

test("canonical catalog carries product and variant metadata without prices", () => {
  const data = catalog();
  assert.equal(data.products.length, 16);
  assert.equal(data.product_variants.length, 208);
  assert.deepEqual(data.products.map((product) => product.slug), CATALOG_PRODUCTS);
  assert.equal(data.products.find((product) => product.slug === "multiwash")?.name, "VertKleen MultiWash");

  const hcrTrial = data.product_variants.find((v) => v.sku === "HCRCIP-1G");
  assert.equal(hcrTrial.product_slug, "hcr");
  assert.equal(hcrTrial.active, true);
  assert.equal(hcrTrial.requires_quote, false);

  const watersafeTrial = data.product_variants.find((v) => v.sku === "WS60-1G");
  assert.equal(watersafeTrial.active, true);
  assert.equal(watersafeTrial.requires_quote, false);

  const hcrTote = data.product_variants.find((v) => v.sku === "HCRCIP-275T");
  assert.equal(hcrTote.active, false);
  assert.equal(hcrTote.requires_quote, true);

  const hcrT16Jug = data.product_variants.find((v) => v.sku === "HCR-1G");
  assert.equal(hcrT16Jug.active, true);
  assert.equal(hcrT16Jug.requires_quote, false);

  const descalerTrial = data.product_variants.find((v) => v.sku === "DSC-1G");
  assert.equal(descalerTrial.active, true);
  assert.equal(descalerTrial.requires_quote, false);
  const retiredFields = ["retail_price", "price_per_gallon", "minimum_checkout_price", "currency", "notes", "source"];
  assert.ok(data.product_variants.every((variant) => (
    retiredFields.every((field) => !(field in variant))
  )));
});

test("product catalog policy: verified units are buyable and unverified parcels fail closed", () => {
  const data = catalog();

  const unitGroups = Map.groupBy(
    data.product_variants.filter((v) => v.package_kind === "unit"),
    (v) => `${v.product_slug}|${v.market}|${v.marketing_name}`,
  );
  assert.equal(unitGroups.size, 24, "workbook has 24 product-market presentations");
  for (const [presentation, units] of unitGroups) {
    assert.deepEqual(units.map((v) => Number(v.size_gal)), [0.25, 0.5, 1, 2.5], `${presentation} sizes`);
    const pending = units.filter((v) => [0.25, 0.5].includes(Number(v.size_gal)));
    const ready = units.filter((v) => [1, 2.5].includes(Number(v.size_gal)));
    assert.ok(pending.every((v) => v.active === false && v.intended_active === true));
    assert.ok(pending.every((v) => v.activation_blocker === "shipping_package_profile_missing"));
    assert.ok(ready.every((v) => v.active === true && v.requires_quote === false));
    assert.ok(ready.every((v) => [
      v.shipping_weight_lb,
      v.shipping_length_in,
      v.shipping_width_in,
      v.shipping_height_in,
    ].every((value) => Number(value) > 0)));
  }

  const cases = data.product_variants.filter((v) => v.package_kind === "case");
  assert.equal(cases.length, 64);
  assert.ok(cases.every((v) => v.market === "industrial"));
  assert.ok(cases.every((v) => v.active === false && v.intended_active === true));
  assert.ok(cases.every((v) => v.activation_blocker === "shipping_package_profile_missing"));
  assert.ok(cases.every((v) => v.unit_sku));

  const bulk = data.product_variants.filter((v) => v.package_kind === "bulk");
  assert.equal(bulk.length, 48);
  assert.ok(bulk.every((v) => v.active === false), "bulk variants should not be checkout-active");
  assert.ok(bulk.every((v) => v.requires_quote === true), "bulk variants should require quote");
  assert.ok(bulk.every((v) => v.intended_active === false));
  assert.ok(data.products.every((product) => product.mode === "buy"));
});

test("canonical catalog carries quote-confirmed services and unique SKUs", () => {
  const data = catalog();
  assert.equal(data.services.length, 35);
  assert.equal(data.service_packages.length, 4);
  assert.deepEqual(data.services.map((service) => service.name), SERVICE_NAMES);
  assert.deepEqual(
    data.service_packages.map((servicePackage) => servicePackage.name),
    SERVICE_PACKAGE_NAMES,
  );

  const allServices = [...data.services, ...data.service_packages];
  const allServiceSkus = allServices.map((s) => s.sku);
  assert.equal(allServiceSkus.length, new Set(allServiceSkus).size);
  assert.ok(allServiceSkus.includes("MS-BID-SPEC-CREATION"));
  assert.ok(allServiceSkus.includes("MS-CONS-PARTICLE-ID"));
  for (const service of allServices) {
    assert.match(service.summary || "", /\S/, `${service.name} needs a buyer-facing deliverable summary`);
  }

  const legionella = data.services.find((s) => s.sku === "MS-LAB-BIO-LEGIONELLA-FULL-CULTURE-SPECIE-ID");
  assert.equal(legionella.mode, "quote_service");
  assert.ok(allServices.every((service) => !("public_price" in service)));
});

test("Water Management Plan services carry one explicit lifecycle sequence", () => {
  const data = catalog();
  const lifecycle = [...data.services, ...data.service_packages]
    .filter((service) => service.lifecycle_stage)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((service) => [service.lifecycle_stage, service.name]);

  assert.deepEqual(lifecycle, [
    ["Assess", "Risk Assessment (ASHRAE 188)"],
    ["Develop", "WMP Development (ASHRAE 188)"],
    ["Confirm", "Plan Certification"],
    ["Monitor", "Monthly Dashboard Access"],
    ["Audit", "Quarterly Audit"],
    ["Renew", "Plan Renewal (annual)"],
    ["Recertify", "Yearly Recertification"],
  ]);
});

test("public service data preserves canonical deliverables and lifecycle metadata", () => {
  const source = catalog();
  const published = JSON.parse(readSite("data/services.json"));
  const sourceRows = [...source.services, ...source.service_packages];
  const publishedRows = [...published.services, ...published.service_packages];

  assert.deepEqual(
    publishedRows.map(({ sku, summary, sort_order, lifecycle_stage }) => ({
      sku,
      summary,
      sort_order,
      lifecycle_stage,
    })),
    sourceRows.map(({ sku, summary, sort_order, lifecycle_stage }) => ({
      sku,
      summary,
      sort_order,
      lifecycle_stage,
    })),
  );
});

test("Supabase seed SQL imports metadata without changing CMS prices", () => {
  const seed = readSite("supabase/variants_seed.sql");
  assert.match(seed, /delete from public\.product_variants where vsku not in/, "variant seed should purge stale DB variants");
  assert.doesNotMatch(seed, /price_tiers|retail_price|public_price/);
  assert.match(seed, /'HCRCIP-1G','hcr','1 gal',1,'industrial','unit','VertKleen CIP HCR',1,null,true,true,null,false,10,6,6,12,'v4\.1 EXTERNAL',3/);
  assert.match(seed, /'WS60-1G','watersafe60','1 gal',1,'industrial','unit','VertKleen WaterSafe60'/);
  assert.match(seed, /'CR-1G','cr2','1 gal',1,'industrial','unit','VertKleen HVAC CR'/);
  assert.match(seed, /'SAR-1G','sar','1 gal',1,'industrial','unit','VertKleen SAR'/);
  assert.doesNotMatch(seed, /VK-PG100|VK-EG5050/);
  assert.match(seed, /'HCRCIP-275T','hcr','275 gal tote',275,'industrial','bulk','VertKleen CIP HCR',1,null,false,false,null,true/);
});

test("segment pricing keeps membership and copy without static prices", () => {
  const data = JSON.parse(readSite("data/segment-pricing.json"));
  assert.equal(
    data.volume_discount,
    "Industrial cases are 10% below the same units bought singly. VK5 saves 5% on eligible online orders.",
  );
  assert.equal(
    data.footer_note,
    "Recommended $75 minimum order. Prices exclude sales tax and freight. FOB Merritt Island, FL. Drums and totes are quote-only.",
  );
  assert.equal(data.source.version, "v4.1 EXTERNAL");
  assert.equal(data.source.sha256, "fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e");
  assert.ok(data.segments.every((segment) => segment.price_tier === "retail"));

  const hvac = data.segments.find((segment) => segment.slug === "hvac-facilities");
  const row = (sku) => hvac.rows.find((item) => item.sku === sku);
  assert.equal(row("HCR-25G").pack, "2.5 gal");
  assert.equal(row("CRHD-55D").quote_only, true);
  assert.ok(data.segments.flatMap((segment) => segment.rows).every((item) => (
    !("price_per_unit" in item) && !("price_per_gallon" in item)
  )));
  const catalogSkus = new Set(catalog().product_variants.map((variant) => variant.sku));
  assert.ok(data.segments.flatMap((segment) => segment.rows).every((item) => catalogSkus.has(item.sku)));
  assert.equal(data.segments.flatMap((segment) => segment.rows).some((item) => item.sku === "VK-MW-1400G"), false);

  const resourcesHtml = readSite("resources.html");
  assert.doesNotMatch(resourcesHtml, /HCR \$43\.26|CR \$38\.53|CR HD \$23\.57|\$58\.61/);
  assert.doesNotMatch(resourcesHtml, /FOB ex-plant, Melbourne FL|FOB Melbourne, FL/);
});

test("public pricing surfaces avoid retired rates and stale FOB wording", () => {
  const publicPricingPages = [
    "products.html",
    ...CATALOG_ORDER.map((id) => `products/${id}.html`),
    "cart.html",
    "resources.html",
    "programs.html",
    "pricing-hvac-facilities.html",
    "pricing-cip-food-beverage.html",
  ];
  const stalePublicPricing = /\$12\.02|\$43\.26|\$38\.53|\$23\.57|\$58\.61|FOB ex-plant, Melbourne FL|FOB Melbourne, FL|FOB Origin \(Cocoa \/ Melbourne\)|FOB Ex Plant Merritt Island, FL/;
  for (const page of publicPricingPages) {
    assert.doesNotMatch(readSite(page), stalePublicPricing, `${page} should not publish retired pricing or stale FOB text`);
  }
});

test("seed script imports products, variants, and services from canonical catalog", () => {
  const script = readFileSync(new URL("../tools/seed-products.mjs", import.meta.url), "utf8");
  assert.match(script, /catalog\.seed\.json/);
  assert.match(script, /\['products', products, 'sku'\]/);
  assert.match(script, /\['product_variants', variants, 'vsku'\]/);
  assert.match(script, /\['services', services, 'sku'\]/);
  assert.match(script, /deleteStaleRows\('product_variants', 'vsku', currentVariants\)/);
  assert.doesNotMatch(script, /price_tiers|retail_price|public_price:\s*s\.public_price/);
});

test("raw tier-pricing table is not publicly readable", () => {
  const schema = readSite("supabase/schema-pricing.sql");
  assert.match(schema, /price_tiers_no_public_read/);
  assert.match(schema, /revoke all on public\.price_tiers from anon, authenticated/);
  assert.doesNotMatch(schema, /grant select on public\.price_tiers to anon, authenticated/);
});

test("public catalog excludes non-canonical program aliases", () => {
  const data = catalog();
  const slugs = data.products.map((product) => product.slug);
  assert.equal(data.products.length, 16);
  assert.ok(!slugs.includes("crs"), "CRS needs owner confirmation before public ecommerce listing");
  assert.ok(!slugs.includes("dbnpa"), "discontinued DBNPA must stay out of the public catalog");
  assert.ok(!slugs.includes("pg100"), "PG/EG glycol products are not in the canonical catalog");
  assert.ok(!slugs.includes("eg5050"), "PG/EG glycol products are not in the canonical catalog");
});

test("legacy non-catalog product routes are not published as static product pages", () => {
  const legacy = ["crs", "dbnpa", "pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"];
  const sitemap = readSite("sitemap.xml");
  for (const slug of legacy) {
    assert.equal(existsSync(new URL(`../products/${slug}.html`, import.meta.url)), false, `${slug} should not have a static product page`);
    assert.doesNotMatch(sitemap, new RegExp(`/products/${slug}(?:<|$)`), `${slug} should not be in sitemap`);
  }
});

test("site copy respects documentation claim guardrails", () => {
  const catalogJs = readSite("js/main/catalog-data.js");
  const productHtml = CATALOG_ORDER.map((id) => readSite(`products/${id}.html`)).join("\n");
  const productsHtml = readSite("products.html");
  const resourcesHtml = readSite("resources.html");
  const programsHtml = readSite("programs.html");
  const aboutHtml = readSite("about.html");
  const chromeJs = readSite("js/main/chrome.js");
  const publicMarketingCopy = [
    readSite("index.html"),
    readSite("industries.html"),
    readSite("proof.html"),
    readSite("comparisons/cr-hd-vs-simple-green.html"),
    readSite("blog/cr-hd-vs-simple-green.html"),
    readSite("data/catalog.seed.json"),
    readSite("data/segment-pricing.json"),
    readSite("data/content/industry-sectors.json"),
    readSite("data/content/blog.json"),
    readSite("data/content/proof.json"),
    readSite("data/content/site-images.json"),
    readSite("js/main/catalog-data.js"),
    readSite("js/main/chrome.js"),
    readSite("about.html"),
    readSite("contact.html"),
    readSite("programs.html"),
    readSite("tools/gen_comparisons.mjs"),
    readSite("tools/gen_industries.mjs"),
    readSite("supabase/seed-industry-sectors.sql"),
  ].join("\n");
  const publicClaimCopy = `${publicMarketingCopy}\n${resourcesHtml}\n${productHtml}`;

  assert.doesNotMatch(productHtml, /crs:\s*"descaler"/, "CRS should not inherit Descaler commerce pricing");
  assert.ok(
    catalog().products.every((product) => product.hmis === "0-0-0"),
    "every offered product must retain its confirmed HMIS 0-0-0 rating",
  );
  assert.match(
    publicMarketingCopy,
    /Every VertKleen product MASEST offers is rated HMIS 0-0-0\./i,
  );
  assert.match(productsHtml, /Compare what each product removes, where it works best, pack pricing, and real-world results\./i);
  assert.doesNotMatch(productsHtml, /exact-product record|before purchase and use/i);
  assert.doesNotMatch(`${programsHtml}\n${readSite("contact.html")}`, /\bDBNPA\b/i);
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
  assert.doesNotMatch(publicMarketingCopy, /CR and HCR proven|breweries proven/i);
  assert.doesNotMatch(publicMarketingCopy, /no fume events, no evacuations, no shutting a wing/i);
  assert.doesNotMatch(publicMarketingCopy, /less HazCom paperwork/i);
  assert.doesNotMatch(publicMarketingCopy, /Legionella compliance/i);
  assert.doesNotMatch(publicMarketingCopy, /ready for federal, state, local/i);
  assert.doesNotMatch(publicMarketingCopy, /drone-rated|precision degreasing without corrosion/i);
  assert.doesNotMatch(publicMarketingCopy, /Antimicrobial &(?:amp;|) biofilm support/i);
  assert.doesNotMatch(publicMarketingCopy, /no respirator program|crews keep working while it cleans|no strict-handling plan|no DOT freight, no disposal fees/i);
  assert.doesNotMatch(publicClaimCopy, /Minimum-risk antimicrobial and odor-control support|Antimicrobial multi-surface cleaner|neutralizes odors at molecular level/i);
  assert.doesNotMatch(publicClaimCopy, /FIFRA 25\(b\) minimum-risk/i);
  assert.doesNotMatch(publicClaimCopy, /SAM\.gov registered|procurement-ready/i);
  assert.doesNotMatch(publicClaimCopy, /drops the hazard rating to 0-0-0/i);
  assert.doesNotMatch(publicClaimCopy, /service with the building still occupied|turn maintenance into an evacuation|fewer HazCom headaches/i);
  assert.doesNotMatch(publicClaimCopy, /Biodegrades in under 10 days|no toxic fuming/i);
  assert.doesNotMatch(publicClaimCopy, /Engineering-reviewed ASHRAE 188 WMP|Legionella assessment and full injection system|quarterly Legionella|24\/7 response/i);
  assert.doesNotMatch(publicClaimCopy, /without acid fumes, a solvent storage cabinet, or hazmat freight|students and staff still on campus|without handling hydrochloric acid/i);
  assert.doesNotMatch(publicClaimCopy, /non-corrosive hydrochloric-acid replacement|Non-corrosive coil descaler|no harsh fumes around the water/i);
  assert.doesNotMatch(publicClaimCopy, /Days to biodegrade|lower ratings can reduce PPE requirements|fewer segregation rules/i);
  assert.doesNotMatch(publicClaimCopy, /HMIS 0-0-0 replacements for acid/i);
  assert.doesNotMatch(resourcesHtml, /minimum-risk antimicrobial support/i);
  assert.doesNotMatch(resourcesHtml, /data-source-table="(?:cooling-tower-traditional-vs-vertkleen|descaler-vs-acids-corrosion|dealership-area-dilution|carib-brewery-lab-results)"/);
});
