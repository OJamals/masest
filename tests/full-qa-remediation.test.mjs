import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const base = "https://masest.co";
const comparisonSlugs = [
  "vertkleen-hcr-vs-clr",
  "hcr-vs-rydlyme",
  "cr-hd-vs-simple-green",
  "lam3-vs-wet-forget",
  "beer-line-cleaner-cost-comparison",
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function sitemapEntries() {
  return [...read("sitemap.xml").matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
    block: match[1],
    loc: match[1].match(/<loc>([^<]+)<\/loc>/)?.[1] || "",
  }));
}

function fileForUrl(url) {
  const pathname = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  if (!pathname) return "index.html";
  return `${pathname}.html`;
}

function publicHtmlFiles() {
  return sitemapEntries()
    .map(({ loc }) => fileForUrl(loc))
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function mainWordCount(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || "";
  return main
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ")
    .replace(/[^A-Za-z0-9+’'-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function bodyWordCount(markdown) {
  return String(markdown)
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[`#>*_~|-]/g, " ")
    .replace(/[^A-Za-z0-9+’'-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

test("shared navigation collapses before tablet-width links overlap", () => {
  const css = read("css/navigation.css");
  assert.match(css, /@media\s*\(min-width:\s*821px\)/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.nav-links\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.nav-links\.open\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.nav-burger\s*\{[\s\S]*?display:\s*block/);
});

test("comparison pages have internal discovery links and unique search titles", () => {
  const publicFiles = publicHtmlFiles();
  const inbound = new Map(comparisonSlugs.map((slug) => [`${base}/comparisons/${slug}`, []]));
  const titles = new Map();

  for (const file of publicFiles) {
    const html = read(file);
    const pageUrl = new URL(file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`, base);
    for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
      const href = match[1];
      if (/^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue;
      const resolved = new URL(href, pageUrl).href.replace(/\/$/, "");
      if (inbound.has(resolved) && file !== fileForUrl(resolved)) inbound.get(resolved).push(file);
    }
    if (/^(?:blog|comparisons)\//.test(file)) {
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
      assert.ok(title, `${file}: title`);
      assert.equal(titles.has(title), false, `${file}: duplicate title with ${titles.get(title)}`);
      titles.set(title, file);
    }
  }

  for (const [url, sources] of inbound) {
    assert.ok(sources.length > 0, `${url}: no inbound internal link`);
  }
});

test("product, comparison, and blog decision content is substantive", () => {
  for (const slug of comparisonSlugs) {
    const file = `comparisons/${slug}.html`;
    assert.ok(mainWordCount(read(file)) >= 275, `${file}: thin comparison content`);
  }

  for (const file of fs.readdirSync(path.join(root, "products")).filter((name) => name.endsWith(".html"))) {
    assert.ok(mainWordCount(read(`products/${file}`)) >= 270, `products/${file}: thin product content`);
  }

  const posts = JSON.parse(read("data/content/blog.json")).blog_posts;
  for (const post of posts) {
    assert.ok(bodyWordCount(post.body) >= 155, `blog/${post.slug}: thin source content`);
  }
});

test("public copy retains VertKleen branding", () => {
  const files = [...publicHtmlFiles(), "js/main/catalog-data.js"];
  const forbidden = /\b(?:SynTech|SynClean|Xtreme)\b/i;
  const offenders = files.filter((file) => forbidden.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("product schema includes SKU identity without stale static offers", () => {
  const catalog = JSON.parse(read("data/catalog.seed.json"));
  const skuByPage = new Map(catalog.products.map((product) => [
    product.slug === "cr-hd" ? "crhd" : product.slug,
    product.sku_stem,
  ]));
  for (const file of fs.readdirSync(path.join(root, "products")).filter((name) => name.endsWith(".html"))) {
    const html = read(`products/${file}`);
    const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => block["@graph"] || [block]);
    const schema = nodes.find((node) => node["@type"] === "Product");
    assert.equal(schema?.sku, skuByPage.get(file.replace(/\.html$/, "")), `products/${file}: product sku`);
    assert.equal(schema?.offers, undefined, `products/${file}: static offers`);
  }
});

test("sitemap publishes accurate-format last modification dates", () => {
  for (const { loc, block } of sitemapEntries()) {
    assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `${loc}: lastmod`);
  }
});

test("product imagery does not upscale beyond source width and the catalog hero stays text-led", () => {
  const css = read("css/style.css");
  assert.match(css, /\.product-shot\s*\{[\s\S]*?max-width:\s*900px/);
  const products = read("products.html");
  // This assertion used to require a high-priority preload of hvac-hcr-studio.webp and
  // lazy, low-priority loading for the other two bottles in the hero collage. Its subject
  // was "secondary hero media is deferred" - a ratchet against hero imagery costing LCP.
  //
  // The collage is gone: it stood 474px tall on a page where no product was visible
  // without scrolling, and its lead image held a high-priority preload slot for a
  // decoration. A text-led hero satisfies that ratchet's intent more completely than
  // preloading ever did, so the assertion moves with it rather than pinning a mechanism
  // whose subject no longer exists.
  assert.doesNotMatch(
    products,
    /<link\s+rel=["']preload["']\s+as=["']image["']/,
    "the catalog hero is text-led; nothing on it should hold an image preload slot",
  );
  const heroMarkup = products.slice(0, products.indexOf('id="catalog"'));
  assert.doesNotMatch(heroMarkup, /<img/i, "no eager hero imagery above the catalog section");
});

test("HCR marketing uses the published rust-and-scale field records", () => {
  const proofCards = JSON.parse(read("data/content/proof.json")).proof_cards;
  assert.equal(proofCards.some(({ slug }) => slug === "ddc-rust-test"), true);
  assert.equal(proofCards.some(({ slug }) => slug === "brevard-farm-hvac"), true);

  const publicSources = [
    read("products.html"),
    read("comparisons/vertkleen-hcr-vs-clr.html"),
    read("blog.html"),
    read("blog/vertkleen-hcr-vs-clr.html"),
    read("data/content/blog.json"),
    read("supabase/seed-proof-cards.sql"),
  ].join("\n");
  assert.match(publicSources, /ddc-rust(?:-test|\.webp)/);
  assert.match(read("products.html"), /href="proof#brevard-farm-hvac"/);
  assert.match(publicSources, /farm-rust-after\.webp/);
});

test("public marketing headings use the preferred Satoshi 700 face", () => {
  const style = read("css/style.css");

  assert.match(style, /--heading-weight:\s*700/);
  assert.match(style, /h1,[\s\S]*?h2,[\s\S]*?h3\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.match(style, /\.display\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.doesNotMatch(style, /\.display\s*\{[^}]*font-weight:\s*900/);
});
