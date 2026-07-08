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
        .map((r) => `<li><a href="../blog/${attr(r.slug)}"><span class="blog-related-cat">${text(r.category)}</span>${text(r.title)}</a></li>`)
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
<link rel="stylesheet" href="../css/style.css?v=20260706c">
<link rel="stylesheet" href="../css/navigation.css?v=20260706a">
<link rel="stylesheet" href="../css/components.css">
<link rel="stylesheet" href="../css/blog.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog/${post.slug}">
<meta property="og:url" content="${BASE}/blog/${post.slug}">
<meta property="og:image" content="${attr(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(articleSchema(post))}</script>
<!-- /seo:auto -->
</head>
<body class="site-soft-bg blog-post-page">
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <a href="../industries">Industries</a>
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
<script type="module" src="../js/main.js?v=20260619b"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
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
  // index + feed + sitemap are added in later tasks.
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
