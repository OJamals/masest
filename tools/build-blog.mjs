#!/usr/bin/env node
// Blog page generator. Reads data/content/blog.json (the committed CMS snapshot)
// and writes static /blog.html, /blog/<slug>.html, and /blog/feed.xml, then
// merges blog URLs into sitemap.xml. The production prebuild runs this after
// refreshing CMS snapshots and before seo-inject regenerates the final sitemap.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, escapeHtml, readingTime } from "./_md.mjs";
import { canonicalPublicImageUrl } from "../js/image-url.js";
import { specializedContentDeliveries } from "../js/content-types.js";
import { STYLE_VERSION } from "./static-release.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = "https://masest.co";
const BLOG_DELIVERY = specializedContentDeliveries()
  .find(({ generator }) => generator === "blog_pages");
if (!BLOG_DELIVERY) throw new Error("blog_delivery_missing");
const SITE_IMAGE_DIMENSIONS = new Map(
  JSON.parse(readFileSync(join(ROOT, "data/content/site-images.json"), "utf8")).assets
    .map((asset) => [asset.public_url, { width: asset.width, height: asset.height }]),
);
const CATEGORIES = new Set(["marketing", "technical", "news"]);
const REQUIRED = ["title", "category", "date", "excerpt", "body"];
const COMPARISON_HERO_SIZE = { width: 1448, height: 1086 };
const COMPARISON_HEROES = new Map([
  ["vertkleen-hcr-vs-clr", {
    url: "/img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp",
    alt: "VertKleen HVAC HCR and CLR PRO MAX Industrial Descaler containers side by side",
  }],
  ["hcr-vs-rydlyme", {
    url: "/img/blog/comparisons/hcr-vs-rydlyme-split.webp",
    alt: "VertKleen HVAC HCR and RYDLYME descaler containers side by side",
  }],
  ["cr-hd-vs-simple-green", {
    url: "/img/blog/comparisons/cr-hd-vs-simple-green-split.webp",
    alt: "VertKleen CR HD and Simple Green Industrial Cleaner and Degreaser containers side by side",
  }],
  ["lam3-vs-wet-forget", {
    url: "/img/blog/comparisons/lam3-vs-wet-forget-split.webp",
    alt: "VertKleen LAM3 and Wet and Forget Outdoor Concentrate containers side by side",
  }],
  ["beer-line-cleaner-cost-comparison", {
    url: "/img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp",
    alt: "VertKleen CIP CR and CIP HCR beside Micro Matic Alkaline Beer Line Cleaner",
  }],
]);
const ORG = {
  "@type": "Organization",
  name: "MASEST Consulting LLC",
  url: `${BASE}/`,
  logo: `${BASE}/img/masest-logo.png`,
  brand: "VertKleen",
  description: "VertKleen pairs industrial cleaning performance with HMIS 0-0-0 across every current product MASEST offers.",
  areaServed: "United States and international commercial accounts",
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "sales",
    url: `${BASE}/contact`,
  },
};

const text = (s) => escapeHtml(s);
const attr = (s) => escapeHtml(s);

// Serialize JSON-LD for embedding in an HTML <script> block. Escapes "<" so a
// CMS-authored string containing "</script>" (title, excerpt, author) cannot
// terminate the script element and inject markup into the reader's page.
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");

function validate(posts) {
  const seen = new Set();
  for (const p of posts) {
    for (const key of REQUIRED) {
      if (!p[key] || String(p[key]).trim() === "") {
        throw new Error(`blog: post "${p.slug || "?"}" is missing required field "${key}"`);
      }
    }
    if (!CATEGORIES.has(p.category)) {
      throw new Error(`blog: post "${p.slug}" has invalid category "${p.category}" (must be marketing/technical/news)`);
    }
    if (Number.isNaN(Date.parse(p.date))) {
      throw new Error(`blog: post "${p.slug}" has unparseable date "${p.date}"`);
    }
    if (seen.has(p.slug)) throw new Error(`blog: duplicate slug "${p.slug}"`);
    seen.add(p.slug);
  }
}

// Newest first; slug as a deterministic tiebreak for byte-stable output.
function sortPosts(posts) {
  return [...posts].sort((a, b) =>
    Date.parse(b.date) - Date.parse(a.date) || a.slug.localeCompare(b.slug));
}

function relatedPosts(post, all) {
  const others = all.filter((p) => p.slug !== post.slug);
  const tags = new Set(post.tags || []);
  const score = (p) =>
    (p.category === post.category ? 100 : 0) + (p.tags || []).filter((t) => tags.has(t)).length;
  return [...others]
    .sort((a, b) => score(b) - score(a) || Date.parse(b.date) - Date.parse(a.date) || a.slug.localeCompare(b.slug))
    .slice(0, 3);
}

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function publicSiteImageUrl(value) {
  const canonical = canonicalPublicImageUrl(value);
  if (!canonical || canonical.startsWith("/")) return canonical;
  if (!/^https?:\/\//i.test(canonical)) return "";
  try {
    const remote = new URL(canonical);
    const marker = "/site/img/";
    const markerAt = remote.pathname.lastIndexOf(marker);
    if (markerAt < 0) return "";
    return `/img/${remote.pathname.slice(markerAt + marker.length)}${remote.search}`;
  } catch {
    return "";
  }
}

function postHero(post) {
  const comparison = COMPARISON_HEROES.get(post.slug);
  if (comparison) return { ...comparison, size: COMPARISON_HERO_SIZE };
  const heroUrl = publicSiteImageUrl(post.hero);
  if (!heroUrl?.startsWith("/")) return null;
  const size = SITE_IMAGE_DIMENSIONS.get(new URL(heroUrl, BASE).pathname);
  return size ? { url: heroUrl, size, alt: post.hero_alt || post.title } : null;
}

function articleSchema(post, heroUrl = "") {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": post.author ? "Person" : "Organization", name: post.author || "MASEST" },
    image: heroUrl ? `${BASE}${heroUrl}` : `${BASE}/img/og-card.png`,
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
    publisher: ORG,
  };
}

function postPage(post, all) {
  const rt = readingTime(post.body);
  const bodyHtml = renderMarkdown(post.body);
  const hero = postHero(post);
  const heroImg = hero
    ? `<figure class="blog-hero-media"><img src="${attr(hero.url)}" alt="${attr(hero.alt)}" width="${hero.size.width}" height="${hero.size.height}" fetchpriority="high" decoding="async"></figure>`
    : "";
  const related = relatedPosts(post, all);
  const relatedHtml = related.length
    ? `<aside class="blog-related"><h2>Related reading</h2><ul>${related
        .map((r) => `<li><a href="../blog/${attr(r.slug)}"><span class="blog-related-cat">${text(r.category)}</span> ${text(r.title)}</a></li>`)
        .join("")}</ul></aside>`
    : "";
  const ogImage = hero ? `${BASE}${hero.url}` : `${BASE}/img/og-card.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${text(post.title)} | MASEST VertKleen</title>
<meta name="description" content="${attr(post.excerpt)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="${attr(post.title)}">
<meta property="og:description" content="${attr(post.excerpt)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=20260713a">
<link rel="stylesheet" href="../css/components.css">
<link rel="stylesheet" href="../css/blog.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog/${post.slug}">
<meta property="og:url" content="${BASE}/blog/${post.slug}">
<meta property="og:image" content="${attr(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson(articleSchema(post, hero?.url))}</script>
<!-- /seo:auto -->
</head>
<body class="site-soft-bg blog-post-page">
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <span>Use Cases</span>
  <a href="../industries">Industries</a>
  <a href="../proof">Proof</a>
  <a href="../resources">Resources</a>
  <a href="../blog">Blog</a>
</nav>
</noscript>
<main id="main">
  <article class="blog-post wrap">
    <p class="blog-eyebrow"><a href="../blog">Blog</a> · <span class="blog-cat">${text(post.category)}</span></p>
    <h1 class="display">${text(post.title)}</h1>
    <p class="blog-byline">${post.author ? `${text(post.author)} · ` : ""}${text(fmtDate(post.date))} · ${rt} min read</p>
    ${heroImg}
    <div class="blog-body">${bodyHtml}</div>
    ${relatedHtml}
    <aside class="blog-cta">
      <h2>Need this chemistry for your facility?</h2>
      <p>Match a VertKleen product to your application or request program pricing.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="../contact?type=quote">Request a quote</a>
        <a class="btn btn-ghost" href="../products">Browse products</a>
      </div>
    </aside>
  </article>
</main>
<script type="module" src="../js/main.js?v=20260807a"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

function postCard(post) {
  const hero = postHero(post);
  const thumb = hero
    ? `<img class="blog-card-img" src="${attr(hero.url)}" alt="${attr(hero.alt)}" width="${hero.size.width}" height="${hero.size.height}" loading="lazy" decoding="async">`
    : `<div class="blog-card-img blog-card-img--fallback" aria-hidden="true"></div>`;
  const tags = (post.tags || []).map((t) => attr(t)).join(" ");
  return `<article class="blog-card" data-slug="${attr(post.slug)}" data-category="${attr(post.category)}" data-tags="${tags}">
    <a class="blog-card-link" href="/blog/${attr(post.slug)}">
      ${thumb}
      <span class="blog-card-cat">${text(post.category)}</span>
      <h2 class="blog-card-title">${text(post.title)}</h2>
      <p class="blog-card-excerpt">${text(post.excerpt)}</p>
      <span class="blog-card-date">${text(fmtDate(post.date))}</span>
    </a>
  </article>`;
}

function indexPage(posts) {
  const cats = ["all", ...CATEGORIES];
  const chips = cats
    .map((c) => `<button type="button" class="blog-chip${c === "all" ? " is-active" : ""}" data-filter-cat="${c}" aria-pressed="${c === "all" ? "true" : "false"}">${c === "all" ? "All" : c[0].toUpperCase() + c.slice(1)}</button>`)
    .join("");
  const cards = posts.map(postCard).join("\n");
  const schema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "MASEST VertKleen Blog",
    url: `${BASE}/blog`,
    publisher: ORG,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog | MASEST VertKleen</title>
<meta name="description" content="Field notes, technical guides, and program news on lower-hazard VertKleen cleaning chemistry.">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="Blog | MASEST VertKleen">
<meta property="og:description" content="Field notes, technical guides, and program news on VertKleen chemistry.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="alternate" type="application/rss+xml" title="MASEST VertKleen Blog" href="/blog/feed.xml">
<link rel="stylesheet" href="vendor/phosphor/style.css">
<link rel="stylesheet" href="css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="css/navigation.css?v=20260713a">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/blog.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog">
<meta property="og:url" content="${BASE}/blog">
<meta property="og:image" content="${BASE}/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson(schema)}</script>
<!-- /seo:auto -->
</head>
<body class="site-soft-bg blog-index-page">
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="/"><b>MASEST</b></a>
  <a href="products">Products</a>
  <a href="services">Services</a>
  <span>Use Cases</span>
  <a href="industries">Industries</a>
  <a href="proof">Proof</a>
  <a href="resources">Resources</a>
  <a href="blog">Blog</a>
</nav>
</noscript>
<main id="main">
  <section class="hero blog-index-hero">
    <div class="wrap">
      <span class="eyebrow">VertKleen Briefing</span>
      <h1 class="display">Blog</h1>
      <p class="subhead">How the chemistry works, why operators switch, and what changes in the field.</p>
    </div>
  </section>
  <section class="section">
    <div class="wrap" data-blog-filter>
      <div class="blog-chips" role="group" aria-label="Filter by category">${chips}</div>
      <div class="blog-grid">
${cards}
      </div>
      <p class="blog-empty" role="status" aria-live="polite" hidden>No posts match that filter.</p>
    </div>
  </section>
  <section class="block-dark on-dark cta-band">
    <div class="wrap reveal">
      <h2 class="headline">Start with the cleaning problem.</h2>
      <p class="subhead">Match mineral deposits, organic soils, mixed facility work, or bio-active control to the exact VertKleen product.</p>
      <a class="btn btn-primary" href="products#catalog">Browse by cleaning problem</a>
    </div>
  </section>
  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="blog" data-cms-region="body"></div>
</main>
<script type="module" src="js/main.js?v=20260807a"></script>
<script type="module" src="js/blog-index.js"></script>
<script src="js/track.js" defer></script>
</body>
</html>
`;
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function feedXml(posts) {
  const items = posts.map((p) => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${BASE}/blog/${p.slug}</link>
      <guid isPermaLink="true">${BASE}/blog/${p.slug}</guid>
      <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
      <category>${xmlEscape(p.category)}</category>
      <description>${xmlEscape(p.excerpt)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MASEST VertKleen Blog</title>
    <link>${BASE}/blog</link>
    <description>How VertKleen chemistry works, why operators switch, and what changes in the field.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
}

function mergeSitemap(posts, outDir) {
  const smPath = join(outDir, "sitemap.xml");
  if (!existsSync(smPath)) return 0;
  const original = readFileSync(smPath, "utf8");
  const latestPostDate = posts.reduce((latest, post) => post.date > latest ? post.date : latest, "");
  const entries = [
    { url: `${BASE}/blog`, lastmod: latestPostDate, changefreq: "weekly", priority: "0.7" },
    ...posts.map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastmod: p.date, changefreq: "monthly", priority: "0.6" })),
  ];
  const missing = entries.filter(({ url }) => !original.includes(`<loc>${url}</loc>`));
  if (!missing.length) return 0;
  const lines = missing
    .map(({ url, lastmod, changefreq, priority }) => `  <url><loc>${url}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`)
    .join("\n");
  const merged = original.replace(/<\/urlset>/, `${lines}\n</urlset>`);
  if (merged !== original) {
    writeFileSync(smPath, merged);
    return 1;
  }
  return 0;
}

function removeStalePostPages(posts, outDir) {
  const blogDir = join(outDir, "blog");
  if (!existsSync(blogDir)) return 0;
  const currentFiles = new Set(posts.map((post) => `${post.slug}.html`));
  let removed = 0;
  for (const entry of readdirSync(blogDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html") || currentFiles.has(entry.name)) continue;
    unlinkSync(join(blogDir, entry.name));
    removed++;
  }
  return removed;
}

export function buildBlog({ posts, outDir = ROOT, updateSitemap = true } = {}) {
  validate(posts);
  const sorted = sortPosts(posts);
  mkdirSync(join(outDir, "blog"), { recursive: true });
  let changed = removeStalePostPages(sorted, outDir);
  for (const post of sorted) {
    const file = join(outDir, "blog", `${post.slug}.html`);
    const html = postPage(post, sorted);
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (before !== html) { writeFileSync(file, html); changed++; }
  }
  const idxFile = join(outDir, "blog.html");
  const idxHtml = indexPage(sorted);
  if ((existsSync(idxFile) ? readFileSync(idxFile, "utf8") : "") !== idxHtml) {
    writeFileSync(idxFile, idxHtml);
    changed++;
  }
  const feedFile = join(outDir, "blog", "feed.xml");
  const feed = feedXml(sorted);
  if ((existsSync(feedFile) ? readFileSync(feedFile, "utf8") : "") !== feed) {
    writeFileSync(feedFile, feed);
    changed++;
  }
  if (updateSitemap) changed += mergeSitemap(sorted, outDir);
  return { changed, posts: sorted };
}

function main() {
  const snapshotPath = join(ROOT, "data/content", BLOG_DELIVERY.file);
  if (!existsSync(snapshotPath)) {
    console.error(`build-blog: data/content/${BLOG_DELIVERY.file} not found — run publish:content first.`);
    process.exitCode = 1;
    return;
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const posts = snapshot[BLOG_DELIVERY.key] || [];
  const { changed } = buildBlog({ posts });
  console.log(`build-blog: ${posts.length} posts, ${changed} pages written.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
