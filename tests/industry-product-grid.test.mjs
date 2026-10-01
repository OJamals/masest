import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { attr, find, findAll, rawOf } from "../tools/html-query.mjs";
import { industryProductCards, replaceIndustryProductGrid } from "../tools/industry-product-grid.mjs";
import { PRODUCTS, catalogImageDimensions } from "../js/main/catalog-data.js";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const industryPages = readdirSync(new URL("industries/", root)).filter((file) => file.endsWith(".html"));

const GRID = { tag: "div", classes: ["prod-grid", "prod-grid-rec"], attrs: { "data-ind-products": null } };

// parse5 rather than a regex: the cards nest <div>s, so a non-greedy pattern closes on the
// first inner </div> and reports one card per grid however many are there.
function gridOf(html) {
  const node = find(html, GRID, { locations: true });
  if (!node) return null;
  return {
    node,
    ids: String(attr(node, "data-ind-products") || "").split(/\s+/).filter(Boolean),
    cards: findAll(node, { tag: "div", classes: ["prod-card"] }),
    html: rawOf(html, node),
  };
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
    assert.equal(grid.cards.length, grid.ids.length, `${page}: one card per product in data-ind-products`);
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
    const cards = grid.html.slice(grid.html.indexOf(">") + 1, grid.html.lastIndexOf("</div>")).trim();
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
    const sources = findAll(grid.node, { tag: "img" }).map((img) => attr(img, "src"));
    assert.equal(sources.length, grid.ids.length, `${page}: every recommended product must show its own image`);
    for (const src of sources) {
      assert.match(src, /^\.\.\/img\//, `${page}: ${src} must stay relative to /industries/`);
      assert.ok(registered.has(src.replace(/^\.\./, "")), `${page}: ${src} is not in the R2 image registry`);
    }
  }
});

test("every industry card identifies its product and rejects withdrawn or wrong-SKU images", () => {
  const marine = JSON.parse(read("data/industry-applications.json")).industries.find(i => i.slug === "marine");
  const marineImages = new Map(marine.approved_product_names.map(p => [p.base_product, p.image]));
  let count = 0;
  for (const page of industryPages) {
    for (const card of findAll(read(`industries/${page}`), { classes: ["prod-card"] })) {
      count++;
      const id = attr(card, "data-product-id");
      assert.ok(PRODUCTS[id], `${page}: card must identify a known product`);
      const images = findAll(card, { tag: "img" });
      assert.equal(images.length, 1, `${page}: ${id} needs exactly one product image`);
      const image = images[0];
      const path = attr(image, "src").replace(/^\.\.\//, "");
      assert.ok(path.startsWith("img/products/"), `${page}: ${id} cannot show an application image or icon`);
      assert.ok(!PRODUCTS[id].image_replaces?.includes(path), `${page}: ${id} still shows withdrawn artwork`);
      if (!attr(card, "data-label-variant")) assert.equal(path, PRODUCTS[id].image, `${page}: ${id} has the wrong product image`);
      if (page === "marine.html") assert.equal(path, marineImages.get(id), `${page}: ${id} has the wrong marine image`);
      const size = catalogImageDimensions(path);
      assert.equal(Number(attr(image, "width")), size.width, `${page}: ${id} width`);
      assert.equal(Number(attr(image, "height")), size.height, `${page}: ${id} height`);
      if (id === "crs") {
        assert.equal(findAll(card, { tag: "a", attrs: { href: "../products/descaler" } }).length, 0, `${page}: CRS cannot link to Descaler`);
        assert.ok(findAll(card, { tag: "a" }).some(a => attr(a, "href").includes("product=VertKleen%20CRS")), `${page}: CRS inquiry must retain product identity`);
      }
    }
  }
  assert.equal(count, 115, "audit all recommended, specialty-label, and marine cards");
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
