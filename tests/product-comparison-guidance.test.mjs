import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { CATALOG_ORDER } from "../js/main/catalog-data.js";

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const EXPECTED = new Map([
  ["cr", ["beer-line-cleaner-cost-comparison"]],
  ["hcr", ["beer-line-cleaner-cost-comparison"]],
  ["hcr-t16", ["vertkleen-hcr-vs-clr", "hcr-vs-rydlyme"]],
  ["crhd", ["cr-hd-vs-simple-green"]],
  ["lam3", ["lam3-vs-wet-forget"]],
]);

function productComparisonSlugs(html) {
  return [...html.matchAll(/data-product-comparison="([^"]+)"/g)].map((match) => match[1]);
}

test("relevant product routes expose crawlable comparison guidance", () => {
  for (const id of CATALOG_ORDER) {
    const html = read(`products/${id}.html`);
    const expected = EXPECTED.get(id) || [];

    assert.deepEqual(productComparisonSlugs(html), expected, `${id}: comparison links`);

    if (!expected.length) {
      assert.doesNotMatch(html, /product-comparison-panel/);
      continue;
    }

    assert.match(
      html,
      new RegExp(`<article class="product-static-panel product-comparison-panel" aria-labelledby="product-comparisons-${id}">`),
    );
    assert.match(html, /<nav class="product-comparison-links" aria-label="Product comparisons">/);

    for (const slug of expected) {
      assert.equal(
        existsSync(new URL(`comparisons/${slug}.html`, ROOT)),
        true,
        `${slug}: comparison route exists`,
      );
      assert.match(
        html,
        new RegExp(`href="\\.\\.\\/comparisons\\/${slug}"[^>]*data-product-comparison="${slug}"`),
        `${id}: static comparison link to ${slug}`,
      );
    }
  }
});

test("comparison guidance offers decision context without replacing purchase actions", () => {
  for (const id of EXPECTED.keys()) {
    const html = read(`products/${id}.html`);
    const panel = html.match(/<article class="product-static-panel product-comparison-panel"[\s\S]*?<\/article>/)?.[0] || "";

    assert.match(panel, /Compare before you switch\./);
    assert.match(panel, /labor/i);
    assert.match(panel, /class="product-comparison-link"/);
    assert.doesNotMatch(panel, /Add to cart|Get a quote|Try a free sample/);
  }
});
