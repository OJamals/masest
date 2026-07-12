import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("mobile discovery keeps replacement and direct catalog paths", () => {
  const products = read("products.html");
  const css = read("css/style.css");

  assert.match(products, /href="#swap"[\s\S]*?>[\s\S]*?Find replacement/);
  assert.match(products, /href="#catalog">Browse all products<\/a>/);
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
    /body:has\(\.lead-action-bar\.is-visible:not\(\.is-suppressed\)\) \.customer-chat\s*{[^}]*bottom:\s*calc\(max\(12px, env\(safe-area-inset-bottom\)\) \+ 76px\);/s,
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

  assert.match(home, /aria-label="Industrial cleaning power\. None of the hazard\."/);
  assert.match(home, /aria-label="Find your VertKleen replacement"/);
  assert.match(home, /aria-label="Request a VertKleen trial"/);
});
