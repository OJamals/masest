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
  assert.match(source, /proof\.json/);
  assert.match(source, /resources\.json/);
  assert.match(source, /industries\.json/);
  assert.match(source, /faqs\.json/);
});

test("public pages expose CMS mount points without replacing hardcoded fallback content", () => {
  for (const file of ["services.html", "proof.html", "resources.html", "industries.html"]) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /data-cms-content/);
  }
});

test("public CMS renderer supports multi-mount category filters", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  const services = readFileSync(new URL("../services.html", import.meta.url), "utf8");
  const resources = readFileSync(new URL("../resources.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

  assert.match(source, /querySelectorAll/);
  assert.match(source, /dataset\.cmsCategory/);
  assert.match(services, /data-cms-content="faq_blocks"/);
  assert.match(services, /data-cms-category="services"/);
  assert.match(resources, /data-cms-category="resources"/);
  assert.match(css, /\.service-catalog-page \.services-cms-faq\s*\{\s*order:\s*5;/);
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
