import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sitemap = readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");
const verifySite = readFileSync(new URL("../tools/verify_site.mjs", import.meta.url), "utf8");
const sourceText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pages = [...sitemap.matchAll(/<loc>https:\/\/masest\.co\/([^<]*)<\/loc>/g)]
  .map((match) => match[1] || "");

function sourcePath(page) {
  if (!page) return "index.html";
  if (page.startsWith("products/")) return `${page}.html`;
  return `${page}.html`;
}

function html(page) {
  return readFileSync(new URL(`../${sourcePath(page)}`, import.meta.url), "utf8");
}

function metaDescription(markup) {
  const tag = markup.match(/<meta\s+[^>]*name=["']description["'][^>]*>/i)?.[0] || "";
  return tag.match(/\bcontent=(["'])(.*?)\1/i)?.[2] || "";
}

function hasMeta(markup, attr, value) {
  const quoted = `["']${value}["']`;
  return new RegExp(`<meta\\s+[^>]*${attr}=${quoted}`, "i").test(markup);
}

test("public sitemap pages keep concise unique meta descriptions", () => {
  const descriptions = new Map();
  for (const page of pages) {
    const description = metaDescription(html(page));
    assert.ok(description.length >= 80, `${page} description too short`);
    assert.ok(description.length <= 170, `${page} description too long: ${description.length}`);
    assert.ok(!descriptions.has(description), `${page} duplicates ${descriptions.get(description)}`);
    descriptions.set(description, page);
  }
});

test("public sitemap pages expose social preview metadata", () => {
  for (const page of pages) {
    const markup = html(page);

    assert.ok(hasMeta(markup, "property", "og:title"), `${page} missing og:title`);
    assert.ok(hasMeta(markup, "property", "og:description"), `${page} missing og:description`);
    assert.ok(hasMeta(markup, "property", "og:image"), `${page} missing og:image`);
    assert.ok(hasMeta(markup, "name", "twitter:card"), `${page} missing twitter:card`);
  }
});

test("site verifier ignores local audit capture artifacts", () => {
  assert.match(
    verifySite,
    /"masest\.co-audit"/,
    "verify_site should not scan downloaded audit HTML captures as source pages",
  );
});

test("status colors use shared semantic tokens outside the token source", () => {
  const statusSwatches = [
    "#e7f5ed",
    "#17623b",
    "#fae8e6",
    "#8a2d24",
    "#fff2ce",
    "#7a4f00",
    "#fef3c7",
    "#92400e",
    "#fee2e2",
    "#b42318",
    "#fdf1d8",
    "#8a5a09",
    "#f8e3df",
    "#a25b35",
    "#087f5b",
    "#e4f4ea",
    "#1c6b3d",
    "#fbe6cf",
    "#8a4a09",
  ];
  const files = [
    "admin.html",
    "dashboard.html",
    "business.html",
    "account.html",
    "css/components.css",
  ];

  for (const file of files) {
    const source = sourceText(file);
    for (const swatch of statusSwatches) {
      assert.ok(!source.includes(swatch), `${file} uses raw status swatch ${swatch}`);
    }
  }
});

test("public copy avoids absolute safety claims", () => {
  const banned = /\b(?:non[-\s]?toxic|harmless|zero[-\s]?risk|risk[-\s]?free|no[-\s]?fumes|fume[-\s]?free|chemical[-\s]?free|safe for all)\b/i;
  for (const page of pages) {
    const text = html(page)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    assert.equal(text.match(banned)?.[0], undefined, `${page} uses absolute safety claim`);
  }
});
