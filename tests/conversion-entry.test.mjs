import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG_ORDER, PRODUCTS, PRODUCT_CATALOG_COPY } from "../js/main/catalog-data.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("mobile discovery opens directly on the catalog without redundant routing controls", () => {
  const products = read("products.html");
  const css = read("css/style.css");
  const hero = products.match(/<section class="hero product-catalog-hero"[\s\S]*?<\/section>/)?.[0] || "";

  assert.doesNotMatch(hero, /hero-actions|href="#catalog"/);
  assert.doesNotMatch(products, /href="#swap"|id="swap"|id="replacementRouter"|id="swapMatrix"/);
  assert.match(products, /<details class="catalog-buying-details">[\s\S]*<summary>Buying details<\/summary>/);
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*body\.products-page \.catalog-quick-facts\s*\{\s*display:\s*none/,
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*\.shop-chips\s*\{[^}]*overflow-x:\s*auto[^}]*flex-wrap:\s*nowrap/,
  );
  assert.match(products, />CIP pricing<\/a>/, "catalog facts should use the concise CIP pricing label");
  assert.doesNotMatch(products, />CIP food pricing<\/a>/i);
});

test("request page leads into the form before process reassurance", () => {
  const contact = read("contact.html");
  const css = read("css/style.css");
  const start = contact.indexOf('href="#quoteForm">Find my VertKleen product');
  const form = contact.indexOf('id="quoteForm"');
  const assurance = contact.indexOf('class="quote-assurance"');

  assert.ok(start > 0, "contact hero should link directly to the request form");
  assert.ok(form > start, "request form should follow the hero CTA");
  assert.ok(assurance > form, "process reassurance should follow the form instead of blocking it");
  assert.match(css, /#quoteForm\s*{[^}]*scroll-margin-top:\s*74px;/s, "form anchor should clear the sticky header");
});

test("mobile chat clears the persistent lead actions", () => {
  const navigation = read("css/navigation.css");

  assert.match(
    navigation,
    /body:has\(\.lead-action-bar\.is-visible:not\(\.is-suppressed\)\) \.customer-chat\s*{[^}]*bottom:\s*calc\(max\(12px, env\(safe-area-inset-bottom\)\) \+ 76px \+ var\(--customer-chat-avoid, 0px\)\);/s,
    "chat launcher should move above the visible mobile lead bar",
  );
});

test("static product hero exposes buying context before long copy", () => {
  const product = read("products/hcr.html");
  const title = product.indexOf('<h1 class="display">');
  const facts = product.indexOf('class="product-hero-facts"');
  const buy = product.indexOf('class="product-hero-buy"');
  const description = product.indexOf('<p class="subhead">');

  assert.ok(title > 0 && facts > title, "product highlights should follow the title");
  assert.ok(buy > facts, "price and pack controls should follow product highlights");
  assert.ok(description > buy, "buying context should appear before the long product description");
  assert.match(product, /<b>HMIS<\/b>0-0-0/);
  assert.match(product, /<b>Alternative to<\/b>Conventional brewery acids and beer-stone cleaners/);
  assert.match(product, /class="btn btn-secondary"[^>]*>Plan my brewery cleaning cycle<\/a>/);
  assert.match(product, /class="product-back-link"[^>]*>All products<\/a>/);
});

test("animated homepage copy keeps stable accessible names", () => {
  const home = read("index.html");

  assert.match(home, /<section class="act"[^>]*aria-labelledby="storyAct1Title">/);
  // The accessible name is the h1's text content, so assert on that rather than on raw
  // markup — inline typographic spans (e.g. .no-break) must not count as a copy change.
  const headline = home.match(/<h1 class="act-h" id="storyAct1Title"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.equal(
    String(headline).replace(/<[^>]+>/g, ""),
    "Industrial cleaning power without the harsh-chemical tradeoff.",
  );
  assert.match(home, /aria-label="Shop VertKleen by cleaning job"/);
  assert.match(home, /aria-label="Plan a VertKleen field trial"/);
  assert.doesNotMatch(home, /starting candidate|trial candidate|Candidate only after|path to approval/i);
  assert.match(home, /Break down and rinse away/);
  assert.match(home, /Completed-task cost/);
  assert.doesNotMatch(home, /class="cmp-table cmp-jobs"/);
});

test("CIP pricing label stays consistent across entry, detail, and resource surfaces", () => {
  const products = read("products.html");
  const pricing = read("pricing-cip-food-beverage.html");
  const resources = read("resources.html");
  const segments = JSON.parse(read("data/segment-pricing.json"));
  const segment = segments.segments.find((item) => item.slug === "cip-food-beverage");

  assert.match(products, />CIP pricing<\/a>/);
  assert.match(pricing, /<title>CIP Pricing \| MASEST VertKleen<\/title>/);
  assert.match(pricing, /<h1 class="display">Put a real price on every CIP cycle\.<\/h1>/);
  assert.equal(segment?.title, "CIP pricing");
  assert.match(
    segment?.rows.find((row) => row.product_slug === "cr")?.application || "",
    /Cuts through fat, protein, yeast, and organic film/,
  );
  assert.match(
    segment?.rows.find((row) => row.product_slug === "hcr")?.application || "",
    /Breaks down beer stone, rust, calcium, and hard-water scale/,
  );
  assert.doesNotMatch(
    segment?.rows.find((row) => row.product_slug === "purgo")?.application || "",
    /candidate|approved label|regulatory review/i,
  );
  assert.match(resources, />Open CIP pricing<\/a>/);
});

test("support routes use task-first science copy without changing destinations", () => {
  const pages = {
    about: read("about.html"),
    services: read("services.html"),
    programs: read("programs.html"),
    resources: read("resources.html"),
    newsletter: read("newsletter.html"),
    hvacPricing: read("pricing-hvac-facilities.html"),
    cipPricing: read("pricing-cip-food-beverage.html"),
    serviceCatalog: read("js/main/service-catalog.js"),
    catalogData: read("js/main/catalog-data.js"),
  };

  assert.match(pages.about, />Request a service quote<\/a>/);
  assert.match(pages.services, />Test the switch before you roll it out\.<\/h1>/);
  for (const label of [
    "Request water analysis",
    "Request biological testing",
    "Request materials analysis",
    "Request bid support",
    "Request technical review",
    "Request site sampling",
    "Request a WMP review",
    "Request a package",
  ]) {
    assert.match(pages.serviceCatalog, new RegExp(label));
  }
  assert.doesNotMatch(pages.serviceCatalog, /Request a deposit test|Request a wash benchmark|Request a cycle review/);
  assert.match(pages.serviceCatalog, /See what is in your water and get a clearer next step/);
  assert.match(pages.serviceCatalog, /Build a practical water plan around your facility, systems, team, and day-to-day work/);
  assert.match(pages.programs, />Price my water-treatment program<\/a>/);
  assert.match(pages.resources, />Get my cleaning plan<\/a>/);
  assert.match(pages.newsletter, />One mechanism\. One field result\. One practical win\.<\/h1>/);
  assert.match(pages.hvacPricing, />Price the result, not the gallon\.<\/h1>/);
  assert.match(pages.hvacPricing, />Request completed-task pricing<\/a>/);
  assert.match(pages.cipPricing, />Request CIP pricing<\/a>/);
  for (const page of [pages.about, pages.services, pages.programs, pages.resources, pages.catalogData]) {
    assert.doesNotMatch(
      page,
      /Independently verified|compliance deadline|verification work|regulatory and label file|Signed trial brief|site approval|Regulatory Status Documentation/i,
    );
  }
});

test("every public product replaces the generic sample CTA with an exact-product label", () => {
  for (const id of CATALOG_ORDER) {
    const publicName = PRODUCTS[id].name.replace(/^VertKleen /, "");
    const cta = PRODUCT_CATALOG_COPY[id]?.sample_cta;
    assert.ok(cta, `${id} needs an exact-product sample CTA`);
    assert.ok(cta.includes(publicName), `${id} sample CTA must use public name "${publicName}"`);
  }
});

test("overlapping product families stay separated by public job scope", () => {
  assert.match(PRODUCT_CATALOG_COPY.hcr.job, /CIP/);
  assert.match(PRODUCT_CATALOG_COPY.cr.job, /CIP/);
  assert.match(PRODUCT_CATALOG_COPY["hcr-t16"].job, /HVAC/);
  assert.match(PRODUCT_CATALOG_COPY.cr2.job, /HVAC/);
  assert.doesNotMatch(PRODUCT_CATALOG_COPY["cr-hd-low-foam"].proof, /adapted/i);
});

test("public content generators preserve current SEO releases", () => {
  const blogBuilder = read("tools/build-blog.mjs");
  const comparisonBuilder = read("tools/gen_comparisons.mjs");
  const seoBuilder = read("tools/seo-inject.mjs");

  assert.match(blogBuilder, /brand: "VertKleen"/);
  assert.match(blogBuilder, /if \(!missing\.length\) return 0;/);
  assert.match(blogBuilder, /style\.css\?v=\$\{STYLE_VERSION\}/);
  assert.match(comparisonBuilder, /style\.css\?v=\$\{STYLE_VERSION\}/);
  assert.match(comparisonBuilder, /<!-- seo:auto -->[\s\S]*<!-- \/seo:auto -->/);
  assert.match(seoBuilder, /<span><b>Alternative to<\/b>\$\{text\(replacement\)\}<\/span>/);
  assert.match(seoBuilder, /<a class="product-back-link"[^>]*>All products<\/a>/);
});
