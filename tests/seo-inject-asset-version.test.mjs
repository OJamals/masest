// Regression guard: tools/seo-inject.mjs regenerates the static product detail
// pages (products/*.html) from a hardcoded template. It should keep a
// cache-busted style.css link, but the exact token is intentionally not pinned
// here because broad generated-page cache-bust churn has proven brittle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const styleVersion = (html) => html.match(/css\/style\.css\?v=([0-9a-z]+)/i)?.[1] || null;

test("seo-inject product template carries a style.css cache-bust", () => {
  const source = read("tools/seo-inject.mjs");
  const tool = source.match(/const STYLE_VERSION = "([0-9a-z]+)"/i)?.[1] || null;
  assert.match(source, /css\/style\.css\?v=\$\{STYLE_VERSION\}/);
  assert.match(tool || "", /^[0-9]{8}[a-z]?$/i, "seo-inject.mjs style.css cache-bust should be date-like");
});

test("regenerated product pages carry a style.css cache-bust", () => {
  for (const file of ["products/cr.html", "products/hcr.html", "products/descaler.html"]) {
    const version = styleVersion(read(file));
    assert.ok(version, `${file} must carry a versioned style.css`);
    assert.match(version, /^[0-9]{8}[a-z]?$/i, `${file} style.css cache-bust should be date-like`);
  }
});
