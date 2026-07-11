#!/usr/bin/env node
// Blog page generator. Reads data/content/blog.json (the committed CMS snapshot)
// and writes static /blog.html, /blog/<slug>.html, and /blog/feed.xml, then
// merges blog URLs into sitemap.xml. Manual + committed build step — run AFTER
// tools/seo-inject.mjs (which regenerates sitemap.xml wholesale). Zero deps.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, escapeHtml, readingTime } from "./_md.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = "https://masest.co";
const CATEGORIES = new Set(["marketing", "technical", "news"]);
const REQUIRED = ["title", "category", "date", "excerpt", "body"];
const ORG = {
  "@type": "Organization",
  name: "MASEST Consulting LLC",
  url: `${BASE}/`,
  logo: `${BASE}/img/masest-logo.png`,
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

function articleSchema(post) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": post.author ? "Person" : "Organization", name: post.author || "MASEST" },
    image: post.hero ? `${BASE}/${post.hero.replace(/^\/+/, "")}` : `${BASE}/img/og-card.png`,
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
    publisher: ORG,
  };
}

function postPage(post, all) {
  const rt = readingTime(post.body);
  const bodyHtml = renderMarkdown(post.body);
  const heroImg = post.hero
    ? `<figure class="blog-hero-media"><img src="../${attr(post.hero)}" alt="${attr(post.hero_alt || post.title)}" fetchpriority="high" decoding="async"></figure>`
    : "";
  const related = relatedPosts(post, all);
  const relatedHtml = related.length
    ? `<aside class="blog-related"><h2>Related reading</h2><ul>${related
        .map((r) => `<li><a href="../blog/${attr(r.slug)}"><span class="blog-related-cat">${text(r.category)}</span> ${text(r.title)}</a></li>`)
        .join("")}</ul></aside>`
    : "";
  const ogImage = post.hero ? `${BASE}/${post.hero.replace(/^\/+/, "")}` : `${BASE}/img/og-card.png`;
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
<link rel="stylesheet" href="../css/style.css?v=20260708c">
<link rel="stylesheet" href="../css/navigation.css?v=20260706a">
<link rel="stylesheet" href="../css/components.css">
<link rel="stylesheet" href="../css/blog.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog/${post.slug}">
<meta property="og:url" content="${BASE}/blog/${post.slug}">
<meta property="og:image" content="${attr(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson(articleSchema(post))}</script>
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
<script type="module" src="../js/main.js?v=20260711h"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

function postCard(post) {
  const thumb = post.hero
    ? `<img class="blog-card-img" src="${attr(post.hero)}" alt="${attr(post.hero_alt || post.title)}" loading="lazy" decoding="async">`
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
<link rel="stylesheet" href="css/style.css?v=20260708c">
<link rel="stylesheet" href="css/navigation.css?v=20260706a">
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
      <p class="subhead">Field notes, technical guides, and program news.</p>
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
      <h2 class="headline">Ready to swap the hazard off your shelf?</h2>
      <p class="subhead">Tell us the chemical you run today and we will match the HMIS 0-0-0 VertKleen replacement, with the documentation your safety officer can sign.</p>
      <a class="btn btn-primary" href="products#swap">Find your replacement</a>
    </div>
  </section>
</main>
<script type="module" src="js/main.js?v=20260711h"></script>
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
  const items = posts.slice(0, 20).map((p) => `    <item>
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
    <description>Field notes, technical guides, and program news on VertKleen chemistry.</description>
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
  // Drop any existing blog url lines so re-runs stay idempotent.
  let xml = original.replace(/^ {2}<url><loc>https:\/\/masest\.co\/blog(?:\/[^<]*)?<\/loc>[^\n]*\n/gm, "");
  const lines = [
    `  <url><loc>${BASE}/blog</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
    ...posts.map((p) => `  <url><loc>${BASE}/blog/${p.slug}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`),
  ].join("\n");
  const merged = xml.replace(/<\/urlset>/, `${lines}\n</urlset>`);
  if (merged !== original) {
    writeFileSync(smPath, merged);
    return 1;
  }
  return 0;
}

export function buildBlog({ posts, outDir = ROOT, updateSitemap = true } = {}) {
  validate(posts);
  const sorted = sortPosts(posts);
  let changed = 0;
  mkdirSync(join(outDir, "blog"), { recursive: true });
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
  const snapshotPath = join(ROOT, "data/content/blog.json");
  if (!existsSync(snapshotPath)) {
    console.error("build-blog: data/content/blog.json not found — run publish:content first.");
    process.exitCode = 1;
    return;
  }
  const { blog_posts: posts = [] } = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const { changed } = buildBlog({ posts });
  console.log(`build-blog: ${posts.length} posts, ${changed} pages written.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
