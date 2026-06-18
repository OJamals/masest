import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function htmlPages() {
  const pages = readdirSync(root)
    .filter((name) => name.endsWith(".html"));
  const industryPages = readdirSync(new URL("industries/", root))
    .filter((name) => name.endsWith(".html"))
    .map((name) => `industries/${name}`);
  return [...pages, ...industryPages].sort();
}

test("main entrypoint imports catalog data from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/catalog-data\.js["']/);
  assert.doesNotMatch(main, /^const PRODUCTS =/m);
  const data = read("js/main/catalog-data.js");
  for (const name of [
    "PRODUCTS",
    "CATALOG_ORDER",
    "CATALOG_GROUPS",
    "REPLACEMENT_MAP",
    "PRODUCT_CATALOG_COPY",
    "PRODUCT_GALLERY",
  ]) {
    assert.match(data, new RegExp(`export const ${name}\\b`), `${name} must be exported`);
  }
});

test("main entrypoint imports chrome rendering from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/chrome\.js["']/);
  assert.doesNotMatch(main, /function renderChrome\s*\(/);

  const chrome = read("js/main/chrome.js");
  assert.match(chrome, /export function renderChrome\s*\(/);
  assert.match(chrome, /foot-secondary/);
  assert.match(chrome, /Resources \+ SDS/);
});

test("main entrypoint imports common effects from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/effects\.js["']/);
  assert.doesNotMatch(main, /function initReveal\s*\(/);
  assert.doesNotMatch(main, /function initResponsiveTables\s*\(/);

  const effects = read("js/main/effects.js");
  assert.match(effects, /export function initReveal\s*\(/);
  assert.match(effects, /export function initResponsiveTables\s*\(/);
  assert.match(effects, /IntersectionObserver/);
});

test("main entrypoint imports service catalog rendering from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/service-catalog\.js["']/);
  assert.doesNotMatch(main, /function initServiceCatalog\s*\(/);
  assert.doesNotMatch(main, /const SERVICE_CATEGORY_COPY\s*=/);

  const services = read("js/main/service-catalog.js");
  assert.match(services, /export function initServiceCatalog\s*\(/);
  assert.match(services, /data-service-catalog/);
  assert.match(services, /catalog\.seed\.json/);
});

test("main entrypoint imports product commerce UI from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/commerce-ui\.js["']/);
  assert.doesNotMatch(main, /function productCard\s*\(/);
  assert.doesNotMatch(main, /const commerceState\s*=/);
  assert.doesNotMatch(main, /function initShop\s*\(/);

  const commerce = read("js/main/commerce-ui.js");
  for (const name of ["productCard", "catalogCard", "initCartButtons", "initShop", "loadCommerceCatalog", "refreshCommerceActions", "isLocalStaticCommerceSuppressed"]) {
    assert.match(commerce, new RegExp(`export (?:async )?function ${name}\\b`), `${name} must be exported`);
  }
  assert.match(commerce, /commerceState/);
  assert.match(commerce, /data-cart-add/);
});

test("main entrypoint imports engagement interactions from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/engagement\.js["']/);
  assert.doesNotMatch(main, /function initQuoteForm\s*\(/);
  assert.doesNotMatch(main, /function initProofFilters\s*\(/);
  assert.doesNotMatch(main, /function initBeforeAfter\s*\(/);

  const engagement = read("js/main/engagement.js");
  for (const name of ["initBeforeAfter", "initProofFilters", "initQuoteForm"]) {
    assert.match(engagement, new RegExp(`export function ${name}\\b`), `${name} must be exported`);
  }
  assert.match(engagement, /matthew@masest\.co/);
  assert.match(engagement, /data-proof-filter/);
});

test("main entrypoint imports media helpers from a split module", () => {
  const main = read("js/main.js");
  assert.match(main, /from\s+["']\.\/main\/media\.js["']/);
  assert.doesNotMatch(main, /function initIndustryProducts\s*\(/);
  assert.doesNotMatch(main, /function initLightbox\s*\(/);
  assert.doesNotMatch(main, /function initImageFallbacks\s*\(/);

  const media = read("js/main/media.js");
  for (const name of ["initIndustryProducts", "initLightbox", "initImageFallbacks"]) {
    assert.match(media, new RegExp(`export function ${name}\\b`), `${name} must be exported`);
  }
  assert.match(media, /data-ind-products/);
  assert.match(media, /lightbox/);
});

test("all pages load shared main as a module", () => {
  const offenders = [];
  for (const page of htmlPages()) {
    const html = read(page);
    if (/js\/main\.js/.test(html) && !/<script\s+type="module"\s+src="(?:\.\.\/)?js\/main\.js"><\/script>/.test(html)) {
      offenders.push(page);
    }
  }
  assert.deepEqual(offenders, []);
});

test("legacy inline pages use the module compatibility surface", () => {
  const main = read("js/main.js");
  assert.match(main, /window\.MASESTMain/);
  assert.match(main, /productCard/);
  assert.match(main, /initReveal/);
  assert.match(read("index.html"), /const \{ initReveal, productCard \} = window\.MASESTMain/);
  assert.match(read("product.html"), /const \{ CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_GALLERY, PRODUCTS, catalogCard, initReveal \} = window\.MASESTMain/);
});
