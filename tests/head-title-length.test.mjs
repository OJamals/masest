import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/* Every shipped page's <title> must fit a search result.
 *
 * Google truncates around 60 characters. Blog titles are built from the post's
 * reader-facing H1, which is written for a reader and routinely ran to 99
 * characters, so tools/build-blog.mjs resolves
 *   post.seo_title (CMS) -> SEO_TITLES[slug] (in that file) -> post.title
 * and comparison pages carry their own seoTitle in tools/gen_comparisons.mjs.
 * A regression here means a new page, or a new post without a SEO_TITLES entry.
 *
 * Entities count as ONE character, because that is what a reader sees: "&amp;"
 * renders as "&". Counting the source text instead reported three pages as
 * broken that were always fine, which is how the original finding got its count
 * wrong. Do not "simplify" this by dropping the decode.
 */

const ROOT = new URL("../", import.meta.url);
const MAX = 60;

// cf-build never publishes these, so their titles are not shipped.
const SKIP = new Set([
  ".git", ".github", ".wrangler", "artifacts", "audit", "audits", "cloudflare",
  "dist", "docs", "factory", "functions", "node_modules", "prototypes",
  "supabase", "test-results", "tests", "tmp", "tools", "_local",
]);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (value) =>
  value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name) => {
    if (ENTITIES[name]) return ENTITIES[name];
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return whole;
  });

function pages(dir = ROOT.pathname, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, found);
    else if (entry.endsWith(".html")) found.push(full);
  }
  return found;
}

test("every shipped page title fits inside a search result", () => {
  const long = [];
  for (const file of pages()) {
    const match = readFileSync(file, "utf8").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) continue;
    const title = decode(match[1].replace(/\s+/g, " ").trim());
    if (title.length > MAX) {
      long.push(`${relative(ROOT.pathname, file)} (${title.length}): ${title}`);
    }
  }
  assert.deepEqual(
    long.sort(),
    [],
    `Title over ${MAX} rendered characters. For a blog post add a SEO_TITLES entry in ` +
      "tools/build-blog.mjs (41 characters, since ' | MASEST VertKleen' spends 19); " +
      "for a comparison page shorten its seoTitle in tools/gen_comparisons.mjs.",
  );
});

test("the length budget is measured on rendered text, not source text", () => {
  assert.equal(decode("Trials, Water Plans &amp; Field Support").length, 35);
  assert.equal(decode("LAM3 vs Wet &amp; Forget: Finished-Area Guide | MASEST VertKleen").length, 60);
});
