import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { industryProductCards, replaceIndustryProductGrid } from "../tools/industry-product-grid.mjs";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const industryPages = readdirSync(new URL("industries/", root)).filter((file) => file.endsWith(".html"));

const GRID_OPEN = /<div class="prod-grid prod-grid-rec" data-ind-products="([^"]*)"\s*>/;

// The cards nest <div>s, so the element has to be closed by matching depth. A
// non-greedy regex closes on the first inner </div> and silently reports one card.
function gridOf(html) {
  const open = html.match(GRID_OPEN);
  if (!open) return null;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = open.index;
  let depth = 0;
  let match;
  while ((match = tag.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return { ids: open[1].split(/\s+/).filter(Boolean), html: html.slice(open.index, match.index + match[0].length) };
    }
  }
  throw new Error("Unclosed recommended-product grid");
}

test("every industry recommended-product grid ships its cards in the HTML", () => {
  // These grids used to be empty mounts filled by initIndustryProducts(), which
  // left 25 of 26 industry pages with no product name in their markup at all.
  // Googlebot renders JavaScript; GPTBot, PerplexityBot and plain text extractors
  // do not, so each page's most commercial section was invisible to them.
  const mounted = [];
  for (const page of industryPages) {
    const grid = gridOf(read(`industries/${page}`));
    if (!grid) continue;
    mounted.push(page);
    assert.ok(grid.ids.length, `${page}: recommended-product grid lists no products`);
    assert.equal(
      (grid.html.match(/class="prod-card/g) || []).length,
      grid.ids.length,
      `${page}: one card per product in data-ind-products`,
    );
    for (const id of grid.ids) {
      assert.ok(grid.html.includes(`href="/products/${id}"`), `${page}: ${id} card links to its product page`);
    }
  }
  assert.equal(mounted.length, 25, "every industry page but marine carries a recommended-product grid");
});

test("server-rendered industry cards are byte-identical to the client renderer", () => {
  // Both sides come from productCard(); this fails the moment the shipped HTML
  // drifts from what js/main/media.js would have rendered, because a populated
  // grid is never repainted.
  for (const page of industryPages) {
    const grid = gridOf(read(`industries/${page}`));
    if (!grid) continue;
    const expected = industryProductCards(grid.ids);
    const cards = grid.html.replace(GRID_OPEN, "").replace(/<\/div>$/, "").trim();
    assert.equal(cards, expected, `${page}: shipped cards differ from productCard() output`);
  }
});

test("industry product images resolve through the R2 media registry", () => {
  // cf-build rewrites registered /img paths to the media host. An unregistered or
  // root-absolute source would ship straight from Pages and bypass R2.
  const registered = new Set(
    JSON.parse(read("data/content/site-images.json")).assets.map((asset) => asset.public_url),
  );
  for (const page of industryPages) {
    const grid = gridOf(read(`industries/${page}`));
    if (!grid) continue;
    const sources = [...grid.html.matchAll(/\ssrc="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(sources.length, `${page}: cards render no product image`);
    for (const src of sources) {
      assert.match(src, /^\.\.\/img\//, `${page}: ${src} must stay relative to /industries/`);
      assert.ok(registered.has(src.replace(/^\.\./, "")), `${page}: ${src} is not in the R2 image registry`);
    }
  }
});

test("hydration leaves a populated grid alone", () => {
  const media = read("js/main/media.js");
  assert.match(media, /if \(box\.querySelector\("\.prod-card"\)\) return;/);
  assert.ok(
    media.indexOf('box.querySelector(".prod-card")') < media.indexOf("box.innerHTML"),
    "the populated-grid check must run before the repaint",
  );
});

test("rebuilding a grid replaces its cards, not just the product list", () => {
  const stale = '<main><div class="prod-grid prod-grid-rec" data-ind-products="hcr"><div class="prod-card"><div></div></div></div><p>tail</p></main>';
  const rebuilt = replaceIndustryProductGrid(stale, ["multiwash"]);

  assert.equal(rebuilt.match(/data-ind-products="([^"]*)"/)[1], "multiwash");
  assert.ok(rebuilt.includes('href="/products/multiwash"'));
  assert.ok(!rebuilt.includes('href="/products/hcr"'));
  assert.ok(rebuilt.endsWith("<p>tail</p></main>"), "content after the grid survives");
  assert.equal(replaceIndustryProductGrid("<p>no grid</p>", ["hcr"]), null);
});
