import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  filterContentRows,
  safeContentHref,
} from "../js/main/content-snapshots.js";

test("public content snapshot helper loads optional CMS snapshots", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  assert.match(source, /loadContentSnapshot/);
  assert.match(source, /fetch\(`\/data\/content\/\$\{file\}`/, "snapshot fetches must be root-relative for extensionless product detail pages");
  assert.match(source, /proof\.json/);
  assert.match(source, /resources\.json/);
  assert.match(source, /industries\.json/);
  assert.match(source, /faqs\.json/);
  assert.match(source, /page-sections\.json/);
  assert.match(source, /pricing\.json/);
});

test("service catalog tries the root CMS snapshot before legacy static services data", () => {
  const source = readFileSync(new URL("../js/main/service-catalog.js", import.meta.url), "utf8");
  assert.match(source, /\["\/data\/content\/services\.json", "\/data\/services\.json"\]/);
});

test("public pages expose CMS mount points without replacing hardcoded fallback content", () => {
  for (const file of ["services.html", "proof.html", "resources.html", "industries.html", "programs.html"]) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /data-cms-content/);
  }
});

test("programs pricing tiers mount as a CMS-replaceable region over hardcoded fallback", () => {
  const html = readFileSync(new URL("../programs.html", import.meta.url), "utf8");
  assert.match(html, /data-cms-content="pricing_tiers"/, "programs.html must mount the pricing_tiers snapshot");
  assert.match(html, /data-cms-render="replace"/, "CMS tiers should replace the hardcoded fallback when present");
  assert.match(html, /class="tier-card/, "hardcoded tier cards must remain as fallback");
});

test("public CMS renderer preserves fallback cards unless replacement is explicit", async () => {
  const snapshots = await import("../js/main/content-snapshots.js");
  assert.equal(typeof snapshots.mergeCmsMountHtml, "function");

  const fallback = '<a class="route-card" href="contact">Static quote path</a>';
  const cms = '<a class="route-card" href="resources">CMS resource path</a>';

  assert.equal(
    snapshots.mergeCmsMountHtml(fallback, cms),
    `${fallback}${cms}`,
    "partial CMS card snapshots should append to existing fallback cards",
  );
  assert.equal(
    snapshots.mergeCmsMountHtml("", cms),
    cms,
    "empty CMS mounts should render CMS rows normally",
  );
  assert.equal(
    snapshots.mergeCmsMountHtml(fallback, cms, { mode: "replace" }),
    cms,
    "explicit replacement mode should replace fallback content",
  );
  assert.equal(
    snapshots.mergeCmsMountHtml(`${fallback}${cms}`, cms, { alreadyLoaded: true }),
    `${fallback}${cms}`,
    "repeated render should not duplicate CMS rows",
  );
});

test("core public pages expose generic CMS page-section slots", () => {
  for (const file of [
    "index.html",
    "about.html",
    "business.html",
    "contact.html",
    "industries.html",
    "product.html",
    "products.html",
    "programs.html",
    "proof.html",
    "resources.html",
    "services.html",
  ]) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /data-cms-content="page_sections"/, `${file} needs a page-section slot`);
    assert.match(html, /data-cms-region="body"/, `${file} needs a body region slot`);
  }
});

test("CMS page-section slots render before final quote CTAs", () => {
  const pages = [
    ["index.html", "block-dark on-dark cta-band"],
    ["about.html", "block-dark on-dark cta-band"],
    ["industries.html", "section class=\"block-dark\""],
    ["product.html", "block-dark on-dark cta-band"],
    ["products.html", "product-job-router block-dark on-dark"],
    ["programs.html", "block-dark on-dark cta-band"],
    ["proof.html", "block-dark on-dark cta-band"],
    ["resources.html", "block-dark on-dark cta-band"],
    ["services.html", "services-final-cta"],
  ];

  for (const [file, marker] of pages) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const slotIndex = html.indexOf('data-cms-content="page_sections"');
    const ctaIndex = html.indexOf(marker);
    assert.ok(slotIndex > -1, `${file} needs a CMS page-section slot`);
    assert.ok(ctaIndex > -1, `${file} needs a final CTA marker`);
    assert.ok(slotIndex < ctaIndex, `${file} CMS slot should render before final CTA`);
  }
});

test("public CMS renderer supports multi-mount category filters", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  const services = readFileSync(new URL("../services.html", import.meta.url), "utf8");
  const resources = readFileSync(new URL("../resources.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

  assert.match(source, /querySelectorAll/);
  assert.match(source, /dataset\.cmsCategory/);
  assert.match(source, /dataset\.cmsPage/);
  assert.match(source, /dataset\.cmsRegion/);
  assert.match(services, /data-cms-content="faq_blocks"/);
  assert.match(services, /data-cms-category="services"/);
  assert.match(resources, /data-cms-category="resources"/);
  assert.match(css, /\.service-catalog-page \.services-cms-faq\s*\{\s*order:\s*5;/);
});

test("public CMS industry cards render editor-managed images", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

  assert.match(source, /route-card-media-card/);
  assert.match(source, /card\.image_alt \|\| card\.title/);
  assert.match(css, /\.route-card-media-card\s*\{/);
  assert.match(css, /\.route-card-media img\s*\{/);
});

test("category filtering returns matching rows and uncategorized fallback rows", () => {
  const rows = [
    { slug: "service-scope", category: "services" },
    { slug: "shared", category: "" },
    { slug: "docs", category: "resources" },
  ];

  assert.deepEqual(
    filterContentRows(rows, { category: "services" }).map((row) => row.slug),
    ["service-scope", "shared"],
  );
  assert.deepEqual(filterContentRows(rows, {}).map((row) => row.slug), ["service-scope", "shared", "docs"]);
});

test("page-section filtering honors page, region, active state, and sort order", () => {
  const rows = [
    { slug: "inactive", page: "home", region: "body", sort_order: 1, active: false },
    { slug: "late", page: "home", region: "body", sort_order: 20, active: true },
    { slug: "early", page: "home", region: "body", sort_order: 2, active: true },
    { slug: "other-page", page: "about", region: "body", sort_order: 3, active: true },
    { slug: "other-region", page: "home", region: "aside", sort_order: 4, active: true },
    { slug: "fallback", page: "", region: "", sort_order: 10, active: true },
  ];

  assert.deepEqual(
    filterContentRows(rows, { page: "home", region: "body" }).map((row) => row.slug),
    ["early", "fallback", "late"],
  );
});

test("public CMS renderer neutralizes unsafe hrefs before insertion", () => {
  assert.equal(safeContentHref("javascript:alert(1)", "resources.html"), "resources.html");
  assert.equal(safeContentHref(" data:text/html,boom ", "industries.html"), "industries.html");
  assert.equal(safeContentHref("contact?type=quote", "resources.html"), "contact?type=quote");
  assert.equal(safeContentHref("https://masest.co/proof", "resources.html"), "https://masest.co/proof");
});

test("main entrypoint imports optional CMS public snapshots", () => {
  const source = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
  assert.match(source, /content-snapshots\.js/);
  assert.match(source, /initContentSnapshots/);
});

test("public CMS renderer supports generic page sections", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

  assert.match(source, /function pageSection/);
  assert.match(source, /cms-page-section/);
  assert.match(source, /safeContentHref\(row\.href/);
  assert.match(source, /btn btn-primary/);
  assert.match(source, /renderMount\("page_sections"/);
  assert.match(css, /\.cms-page-section-inner/);
  assert.match(css, /grid-template-columns: 1fr/);
});
