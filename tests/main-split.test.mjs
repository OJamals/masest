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
  assert.match(read("product.html"), /const \{ CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_GALLERY, PRODUCTS, catalogCard \} = window\.MASESTMain/);
});
