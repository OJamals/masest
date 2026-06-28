// Regression guard: tools/seo-inject.mjs regenerates the static product detail
// pages (products/*.html) from a hardcoded template. Its style.css cache-bust
// must track the live site, or running the SEO regen silently DOWNGRADES the
// cache-bust on every product page (caught 2026-06-28: template was stuck on
// ?v=20260623c while the site had moved to ?v=20260625a).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const styleVersion = (html) => html.match(/css\/style\.css\?v=([0-9a-z]+)/i)?.[1] || null;

test("seo-inject product template style.css cache-bust matches the live site", () => {
  const live = styleVersion(read("index.html"));
  const tool = styleVersion(read("tools/seo-inject.mjs"));
  assert.ok(live, "index.html must carry a versioned style.css");
  assert.ok(tool, "seo-inject.mjs product template must carry a versioned style.css");
  assert.equal(
    tool,
    live,
    `seo-inject style.css cache-bust (${tool}) must equal the live site (${live}); otherwise regenerating product pages downgrades their CSS version`,
  );
});

test("regenerated product pages already carry the live style.css cache-bust", () => {
  // Committed product pages must not lag the live version (drift detector).
  const live = styleVersion(read("index.html"));
  for (const file of ["products/cr.html", "products/hcr.html", "products/descaler.html"]) {
    assert.equal(styleVersion(read(file)), live, `${file} style.css cache-bust must match the live site`);
  }
});
