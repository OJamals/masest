import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CATALOG_ORDER } from "../js/main/catalog-data.js";
import {
  normalizeProductSearch,
  productSearchScore,
  rankProductIds,
} from "../js/main/product-search.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("product search normalizes punctuation, spacing, and diacritics", () => {
  assert.equal(normalizeProductSearch("  HVAC—Scale / CR-HDé  "), "hvac scale cr hde");
});

test("product search supports reordered job terms", () => {
  const hvacScale = rankProductIds(CATALOG_ORDER, "hvac scale");
  const scaleHvac = rankProductIds(CATALOG_ORDER, "scale hvac");

  assert.deepEqual(hvacScale, scaleHvac);
  assert.ok(hvacScale.includes("hcr-t16"));
  assert.ok(hvacScale.includes("descaler"));
});

test("exact product names and IDs rank ahead of broader matches", () => {
  assert.equal(rankProductIds(CATALOG_ORDER, "descaler")[0], "descaler");
  assert.equal(rankProductIds(CATALOG_ORDER, "cr hd")[0], "crhd");
  assert.equal(rankProductIds(CATALOG_ORDER, "hcrt16")[0], "hcr-t16");
});

test("product fuzzy search tolerates common typos and adjacent transpositions", () => {
  assert.equal(rankProductIds(CATALOG_ORDER, "descalre")[0], "descaler");

  const typoResults = rankProductIds(CATALOG_ORDER, "scle hvca");
  assert.ok(typoResults.includes("hcr-t16"));
  assert.ok(typoResults.includes("hcr"));
  assert.ok(typoResults.includes("descaler"));
});

test("product fuzzy search stays conservative for short and unrelated terms", () => {
  assert.deepEqual(rankProductIds(CATALOG_ORDER, "hxr"), []);
  assert.deepEqual(rankProductIds(CATALOG_ORDER, "zzzzzzzz"), []);
});

test("loaded commerce SKU and package data are searchable", () => {
  const rowFor = id => id === "descaler" ? {
    sku: "descaler",
    variants: [{ vsku: "VK-DSC-5", label: "5 gallon pail", marketing_name: "VertKleen Descaler" }],
    quoteVariants: [],
  } : null;

  assert.equal(rankProductIds(CATALOG_ORDER, "vk dsc 5", rowFor)[0], "descaler");
  assert.equal(rankProductIds(CATALOG_ORDER, "vkdsc5", rowFor)[0], "descaler");
  assert.equal(productSearchScore("descaler", "vk dsx 5", rowFor("descaler")), -1);
  assert.equal(productSearchScore("descaler", "not-a-real-product", rowFor("descaler")), -1);
});

test("products toolbar exposes clear, filter, and recommended controls", () => {
  const html = read("products.html");

  assert.match(html, /<label[^>]+for="shopSearch"[^>]*>\s*Search products\s*<\/label>/);
  assert.match(html, /id="shopSearchClear"/);
  assert.match(html, /id="shopClearAll"/);
  assert.match(html, /<option value="featured">Recommended<\/option>/);
  assert.match(html, /Browse by job/);
});

test("zero-result recovery suggestions always lead to grounded catalog matches", () => {
  const html = read("products.html");
  const suggestions = [...html.matchAll(/data-shop-search-suggestion="([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(suggestions, ["scale", "grease", "hvac", "water"]);
  suggestions.forEach((query) => {
    assert.ok(rankProductIds(CATALOG_ORDER, query).length > 0, `${query} should return products`);
  });
  assert.match(html, /id="shopEmptyReset"[^>]+data-shop-reset[^>]+data-customer-chat-obstruction/);
  assert.match(html, /id="shopEmptyContact"[^>]+data-customer-chat-obstruction/);
});
