import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("mobile discovery keeps the direct catalog path without the retired replacement checker", () => {
  const products = read("products.html");
  const css = read("css/style.css");

  assert.match(products, /href="#catalog">Browse all products<\/a>/);
  assert.doesNotMatch(products, /href="#swap"|id="swap"|id="replacementRouter"|id="swapMatrix"/);
  assert.doesNotMatch(
    css,
    /\.product-catalog-hero \.hero-actions \.btn-secondary\s*{[^}]*display:\s*none/i,
    "mobile CSS must not hide the direct catalog path",
  );
  assert.match(products, />CIP pricing<\/a>/, "catalog facts should use the concise CIP pricing label");
  assert.doesNotMatch(products, />CIP food pricing<\/a>/i);
});

test("request page leads into the form before process reassurance", () => {
  const contact = read("contact.html");
  const css = read("css/style.css");
  const start = contact.indexOf('href="#quoteForm">Start your request');
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
});

test("animated homepage copy keeps stable accessible names", () => {
  const home = read("index.html");

  assert.match(home, /<section class="act"[^>]*aria-labelledby="storyAct1Title">/);
  assert.match(
    home,
    /<h1 class="act-h" id="storyAct1Title"[^>]*>Industrial cleaning power\. Lower-hazard candidates\.<\/h1>/,
  );
  assert.match(home, /aria-label="Find your VertKleen replacement"/);
  assert.match(home, /aria-label="Request a VertKleen trial"/);
});

test("CIP pricing label stays consistent across entry, detail, and resource surfaces", () => {
  const products = read("products.html");
  const pricing = read("pricing-cip-food-beverage.html");
  const resources = read("resources.html");
  const segments = JSON.parse(read("data/segment-pricing.json"));
  const segment = segments.segments.find((item) => item.slug === "cip-food-beverage");

  assert.match(products, />CIP pricing<\/a>/);
  assert.match(pricing, /<title>CIP Pricing \| MASEST VertKleen<\/title>/);
  assert.match(pricing, /<h1 class="display">CIP pricing\.<\/h1>/);
  assert.equal(segment?.title, "CIP pricing");
  assert.match(resources, />Open CIP pricing<\/a>/);
});

test("public content generators preserve current SEO releases", () => {
  const blogBuilder = read("tools/build-blog.mjs");
  const comparisonBuilder = read("tools/gen_comparisons.mjs");

  assert.match(blogBuilder, /brand: "VertKleen"/);
  assert.match(blogBuilder, /if \(!missing\.length\) return 0;/);
  assert.match(blogBuilder, /style\.css\?v=\$\{STYLE_VERSION\}/);
  assert.match(comparisonBuilder, /style\.css\?v=\$\{STYLE_VERSION\}/);
  assert.match(comparisonBuilder, /<!-- seo:auto -->[\s\S]*<!-- \/seo:auto -->/);
});
