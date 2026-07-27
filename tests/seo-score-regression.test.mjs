import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PRODUCTS } from "../js/main/catalog-data.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const base = "https://masest.co";
const catalogSeed = JSON.parse(fs.readFileSync(path.join(root, "data/catalog.seed.json"), "utf8"));
const buyableVariants = catalogSeed.product_variants.filter((variant) => (
  variant.active && variant.public_visible && !variant.requires_quote && Number(variant.retail_price) > 0
));
const productIds = fs.readdirSync(path.join(root, "products"))
  .filter((file) => file.endsWith(".html"))
  .map((file) => file.replace(/\.html$/, ""))
  .sort();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function extensionlessUrl(file) {
  if (file === "index.html") return `${base}/`;
  return `${base}/${file.replace(/\.html$/, "")}`;
}

function extractAttr(html, selectorPattern, attr) {
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+${selectorPattern}[^>]*>`, "i"))?.[0] || "";
  return tag.match(new RegExp(`\\b${escapedAttr}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function canonical(html) {
  return html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || "";
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
}

function flattenJsonLd(block) {
  if (Array.isArray(block)) return block.flatMap(flattenJsonLd);
  if (block && Array.isArray(block["@graph"])) return block["@graph"].flatMap(flattenJsonLd);
  return block ? [block] : [];
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, strings));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, strings));
  return strings;
}

const publicHtml = [
  "index.html",
  "products.html",
  "services.html",
  "programs.html",
  "industries.html",
  "proof.html",
  "resources.html",
  "newsletter.html",
  "about.html",
  "contact.html",
  ...fs.readdirSync(path.join(root, "industries"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `industries/${file}`),
];

const publicLinkHtml = [...publicHtml, "product.html"];

test("sitemap lists final extensionless canonical URLs and product details", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locs.length >= publicHtml.length + productIds.length);
  assert.deepEqual(locs.filter((loc) => loc.endsWith(".html")), []);
  assert.deepEqual(locs.filter((loc) => /\/product(?:\.html)?\?/.test(loc)), []);

  for (const file of publicHtml) assert.ok(locs.includes(extensionlessUrl(file)), `${file} missing from sitemap`);
  for (const id of productIds) assert.ok(locs.includes(`${base}/products/${id}`), `${id} product page missing from sitemap`);
});

test("public page canonicals and Open Graph URLs match final extensionless URLs", () => {
  for (const file of publicHtml) {
    const html = read(file);
    const expected = extensionlessUrl(file);
    assert.equal(canonical(html), expected, `${file} canonical`);
    assert.equal(extractAttr(html, 'property=["\']og:url["\']', "content"), expected, `${file} og:url`);
  }
});

test("public page links and schema do not publish stale html URLs", () => {
  const offenders = [];
  const legacyUrl = /(?:^|\/)[a-z0-9_/-]+\.html(?:[?#]|$)|\/product(?:\.html)?\?/i;
  for (const file of publicLinkHtml) {
    const html = read(file);
    for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
      const href = match[1];
      if (/^(?:mailto:|tel:|data:|blob:|javascript:|#)/i.test(href)) continue;
      if (legacyUrl.test(href)) offenders.push(`${file} href ${href}`);
    }
    for (const block of jsonLdBlocks(html)) {
      for (const value of collectStrings(block)) {
        if (/^https:\/\/masest\.co\//.test(value) && legacyUrl.test(value)) {
          offenders.push(`${file} schema ${value}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("product detail pages are static, crawlable, and schema-rich", () => {
  for (const id of productIds) {
    const product = PRODUCTS[id];
    const file = `products/${id}.html`;
    assert.ok(product, `${id} static product page must map to catalog data`);
    assert.ok(fs.existsSync(path.join(root, file)), `${file} missing`);
    const html = read(file);
    assert.match(html, new RegExp(`<title>${product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| MASEST VertKlean<\\/title>`));
    assert.match(html, new RegExp(`<h1[^>]*>${product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/h1>`));
    assert.equal(canonical(html), `${base}/products/${id}`, `${file} canonical`);
    const types = jsonLdBlocks(html).flatMap(flattenJsonLd);
    const schema = types.find((block) => block["@type"] === "Product");
    assert.equal(schema?.name, product.name, `${file} Product schema name`);
    assert.equal(schema?.url, `${base}/products/${id}`, `${file} Product schema url`);
    assert.equal(
      schema?.manufacturer,
      undefined,
      `${file} must not identify a manufacturer without an exact-product source record`,
    );
    const expectedOffers = buyableVariants.filter((variant) => variant.product_slug === id);
    if (expectedOffers.length) {
      assert.equal(schema?.offers?.length, expectedOffers.length, `${file} buyable variant offers`);
      assert.deepEqual(
        schema.offers.map((offer) => offer.sku).sort(),
        expectedOffers.map((variant) => variant.sku).sort(),
        `${file} offer SKUs`
      );
      assert.ok(schema.offers.every((offer) => offer.priceCurrency === "USD" && offer.availability === "https://schema.org/InStock"));
      assert.ok(
        schema.offers.every((offer) => offer.seller?.name === "MASEST Consulting LLC"),
        `${file} offers must identify MASEST as seller`,
      );
    }
  }
});
