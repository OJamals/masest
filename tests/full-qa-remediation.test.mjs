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
    assert.ok(mainWordCount(read(file)) >= 300, `${file}: thin comparison content`);
  }

  for (const file of fs.readdirSync(path.join(root, "products")).filter((name) => name.endsWith(".html"))) {
    assert.ok(mainWordCount(read(`products/${file}`)) >= 270, `products/${file}: thin product content`);
  }

  const posts = JSON.parse(read("data/content/blog.json")).blog_posts;
  for (const post of posts) {
    assert.ok(bodyWordCount(post.body) >= 155, `blog/${post.slug}: thin source content`);
  }
});

test("public copy names VertKleen only and excludes non-toxic wording", () => {
  const files = [...publicHtmlFiles(), "js/main/catalog-data.js"];
  const forbidden = /\b(?:SynTech|SynClean|Xtreme)\b|non[- ]?toxic/i;
  const offenders = files.filter((file) => forbidden.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("product schema includes SKU identity and every buyable CR HD offer", () => {
  for (const file of fs.readdirSync(path.join(root, "products")).filter((name) => name.endsWith(".html"))) {
    const html = read(`products/${file}`);
    const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => block["@graph"] || [block]);
    const schema = nodes.find((node) => node["@type"] === "Product");
    assert.match(schema?.sku || "", /^VK-/, `products/${file}: product sku`);
    if (file === "crhd.html") assert.equal(schema?.offers?.length, 3, "CR HD offers");
  }
});

test("sitemap publishes accurate-format last modification dates", () => {
  for (const { loc, block } of sitemapEntries()) {
    assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `${loc}: lastmod`);
  }
});

test("product imagery does not upscale beyond source width and secondary hero media is deferred", () => {
  const css = read("css/style.css");
  assert.match(css, /\.product-shot\s*\{[\s\S]*?max-width:\s*900px/);
  const products = read("products.html");
  assert.match(
    products,
    /<link\s+rel=["']preload["']\s+as=["']image["']\s+href=["']img\/products\/hvac-hcr-studio\.webp["']\s+fetchpriority=["']high["']>/,
  );
  for (const product of ["crhd", "multiwash"]) {
    const image = products.match(new RegExp(`<img[^>]+src=["'][^"']*${product}[^"']*["'][^>]*>`, "i"))?.[0] || "";
    assert.match(image, /loading=["']lazy["']/);
    assert.match(image, /fetchpriority=["']low["']/);
  }
});

test("HCR marketing uses the canonical before-and-after field record", () => {
  const proofCards = JSON.parse(read("data/content/proof.json")).proof_cards;
  assert.equal(proofCards.some(({ slug }) => slug === "ddc-rust-test"), false);

  const publicSources = [
    read("products.html"),
    read("comparisons/vertkleen-hcr-vs-clr.html"),
    read("blog.html"),
    read("blog/vertkleen-hcr-vs-clr.html"),
    read("data/content/blog.json"),
    read("supabase/seed-proof-cards.sql"),
  ].join("\n");
  assert.doesNotMatch(publicSources, /ddc-rust(?:-test|\.webp)/);
  assert.match(read("products.html"), /href="proof#brevard-farm-hvac"/);
  assert.match(publicSources, /farm-rust-after\.webp/);
});

test("public marketing headings use the preferred Satoshi 700 face", () => {
  const style = read("css/style.css");
  const story = read("css/story.css");

  assert.match(style, /--heading-weight:\s*700/);
  assert.match(style, /h1,[\s\S]*?h2,[\s\S]*?h3\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.match(style, /\.display\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.match(story, /\.story \.act-h\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.match(story, /\.reel-slide figcaption b\s*\{[\s\S]*?font-weight:\s*var\(--heading-weight\)/);
  assert.doesNotMatch(style, /\.display\s*\{[^}]*font-weight:\s*900/);
  assert.doesNotMatch(story, /\.story \.act-h\s*\{[^}]*font-weight:\s*900/);
});
