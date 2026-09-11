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
import { organizationJsonLd } from "./company-identity.mjs";
import { BLOG_VERSION, COMPONENT_VERSION, MAIN_VERSION, NAVIGATION_VERSION, STYLE_VERSION } from "./static-release.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = "https://masest.co";
const BLOG_DELIVERY = specializedContentDeliveries()
  .find(({ generator }) => generator === "blog_pages");
if (!BLOG_DELIVERY) throw new Error("blog_delivery_missing");
const SITE_IMAGE_DIMENSIONS = new Map(
  JSON.parse(readFileSync(join(ROOT, "data/content/site-images.json"), "utf8")).assets
    .map((asset) => [asset.public_url, { width: asset.width, height: asset.height }]),
);
/**
 * Posts whose URL has been retired in favour of a canonical page elsewhere
 * (data/content-redirects.json). The post keeps existing — it is CMS-owned and pinned by
 * PROTECTED_COMPARISON_SLUGS — and its page keeps generating, but every link the site
 * renders to it should address the canonical URL directly rather than travel through the
 * 301. Redirect hops cost a round trip and leak a little link equity at each one.
 *
 * The post page's own canonical/og:url are deliberately NOT rewritten: once the redirect
 * ships, Cloudflare answers /blog/<slug> with a 301 and that HTML is never served, so a
 * cross-canonical there would be dead markup. The 301 is the stronger signal anyway.
 */
const REDIRECTED_POST_URLS = new Map(
  JSON.parse(readFileSync(join(ROOT, "data/content-redirects.json"), "utf8"))
    .redirects
    .filter(({ from }) => from.startsWith("/blog/"))
    .map(({ from, to }) => [from.slice("/blog/".length), to]),
);
const publicPostPath = (slug) => REDIRECTED_POST_URLS.get(slug) || `/blog/${slug}`;

const CATEGORIES = new Set(["marketing", "technical", "news"]);
const CATEGORY_LABELS = {
  marketing: "Product news",
  technical: "How-to guide",
  news: "Company news",
};
const categoryLabel = (category) => CATEGORY_LABELS[category] || category;
const REQUIRED = ["title", "category", "date", "excerpt", "body"];
const ORG = organizationJsonLd();

const text = (s) => escapeHtml(s);

/* SERP titles.
 *
 * post.title is the reader-facing H1 and is never changed here. Google truncates
 * around 60 RENDERED characters and " | MASEST VertKleen" spends 19, leaving 41.
 *
 * Why this map lives in the generator and not in data/content/blog.json: on a
 * production deploy the "Refresh production CMS snapshots" step in verify.yml
 * overwrites data/content/*.json from Supabase before the build runs, so a
 * seo_title added to the repo's blog.json would pass every local test and then
 * silently vanish at deploy time. A CMS-authored post.seo_title still wins when
 * one exists, so populating the field in Supabase later needs no flag day.
 *
 * Resolution order: post.seo_title (CMS) -> SEO_TITLES[slug] (here) -> post.title.
 * Enforced by tests/head-title-length.test.mjs, which counts entities as ONE
 * character because "&amp;" renders as "&".
 */
/* Author entities.
 *
 * The CMS supplies a byline STRING (post.author). The entity behind that string --
 * job title, expertise, employer -- is structural, so it lives here, the same split
 * as SEO_TITLES: content in Supabase, structure in the generator.
 *
 * Two things this fixes. A byline that names a group is not a Person, and emitting
 * one as schema.org/Person is simply wrong: 34 of 35 posts are bylined "MASEST Team"
 * and were being published as a human being. Those now resolve to Organization.
 * And a bare Person with nothing but a name carries no E-E-A-T signal at all, which
 * is what SQ-24 was actually asking for.
 *
 * To byline a post to a person, set post.author to that person's key below IN THE
 * CMS -- editing data/content/blog.json does nothing, because a production deploy
 * overwrites it from Supabase.
 */
const ORGANIZATION = { "@type": "Organization", name: "MASEST Consulting LLC" };

const AUTHORS = {
  Matthew: {
    "@type": "Person",
    name: "Matthew",
    jobTitle: "Founder",
    description:
      "Chemical engineer with years of experience in industrial chemicals and cleaning agents.",
    worksFor: ORGANIZATION,
    knowsAbout: [
      "Industrial cleaning chemistry",
      "Descaling and scale control",
      "Industrial degreasing",
      "Water treatment",
    ],
  },
};

// A byline naming the company or a group is the Organization, not a Person.
const GROUP_BYLINES = new Set(["MASEST", "MASEST Team"]);

function authorEntity(byline) {
  if (!byline || GROUP_BYLINES.has(byline)) return ORGANIZATION;
  return AUTHORS[byline] || { "@type": "Person", name: byline };
}

/* Visible counterpart to the Person schema. A structured-data author nobody can see
   is a claim to a crawler and nothing to a reader, so this renders only for a byline
   that resolves to a real Person entity -- a group byline gets no card. */
function authorCard(byline) {
  const entity = authorEntity(byline);
  if (entity["@type"] !== "Person" || !AUTHORS[byline]) return "";
  return `<aside class="blog-author">
      <p class="blog-author-name">${text(entity.name)}<span> · ${text(entity.jobTitle)}</span></p>
      <p class="blog-author-bio">${text(entity.description)}</p>
    </aside>`;
}


const SEO_TITLES = {
  "beer-line-cleaner-cost-comparison": "Beer line cleaner cost per CIP cycle",
  "car-dealership-cleaning-checklist": "Car dealership cleaning checklist",
  "commercial-drain-odor-control-guide": "Remove commercial drain odors",
  "commercial-gym-cleaning-checklist": "Commercial gym cleaning checklist",
  "commercial-kitchen-degreasing-guide": "Commercial kitchen degreasing guide",
  "construction-equipment-concrete-residue-cleaning": "Clearing concrete residue on site",
  "cooling-tower-cleaning-water-management-plan": "Cooling-tower cleaning program",
  "cr-hd-vs-simple-green": "CR HD vs Simple Green",
  "cr-hd-walmart-distribution-center-case-study": "Why 3 Walmart DCs switched to CR HD",
  "data-center-cooling-maintenance-cleaning": "Data-center cooling scale removal",
  "descaler-fire-pump-walmart-case-study": "Descaler on a Walmart DC fire pump",
  "descaling-without-acid": "Remove scale without mineral acid",
  "drone-building-cleaning-guide": "Drone building & façade cleaning plan",
  "food-plant-cleaning-cip-sanitation-release": "Food-plant CIP cleaning stages",
  "golf-course-equipment-grounds-hardscape-cleaning": "Golf-course equipment & hardscape care",
  "hcr-brevard-hvac-rust-case-study": "HCR vs 20-year HVAC rust: case study",
  "hcr-vs-rydlyme": "VertKleen HCR vs RYDLYME",
  "hotel-property-turnover-facility-cleaning": "Hotel turnover cleaning plan",
  "how-to-clean-oxidized-aluminum-boat": "How to clean an oxidized aluminum boat",
  "how-to-descale-heat-exchanger": "How to descale a heat exchanger",
  "how-to-remove-moss-algae-without-pressure-washing": "Remove moss and algae, no pressure wash",
  "hvac-condensate-drain-line-cleaning-guide": "HVAC condensate drain-line cleaning",
  "industrial-cleaning-trial-scope-isolate-contain-release": "How to trial a safer industrial cleaner",
  "lam3-vs-wet-forget": "LAM3 vs Wet & Forget: finished areas",
  "low-foam-degreaser-parts-washers-floor-scrubbers": "Low-foam degreaser for parts washers",
  "military-government-maintenance-procurement": "Government fleet cleaning orders",
  "neutral-ph-industrial-degreaser-guide": "Neutral-pH industrial degreaser guide",
  "oil-gas-equipment-degreasing-maintenance": "Oil and gas equipment degreasing",
  "school-university-facility-cleaning-plan": "Campus facility cleaning plan",
  "solar-panel-cleaning-low-residue-maintenance": "Low-residue solar panel cleaning",
  "vertkleen-hcr-vs-clr": "VertKleen HCR vs CLR PRO MAX",
  "vertkleen-launch": "Which VertKleen product fits your job?",
  "warehouse-floor-degreasing-guide": "Warehouse floor degreasing guide",
  "watersafe60-water-treatment-guide": "WaterSafe60 water-treatment guide",
};

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
    (p.tags || []).filter((t) => tags.has(t)).length * 100 + (p.category === post.category ? 1 : 0);
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
  const heroUrl = publicSiteImageUrl(post.hero);
  if (!heroUrl?.startsWith("/")) return null;
  const size = SITE_IMAGE_DIMENSIONS.get(new URL(heroUrl, BASE).pathname);
  return size ? { url: heroUrl, size, alt: post.hero_alt || post.title } : null;
}

function isComparisonHero(hero) {
  return hero?.url.startsWith("/img/blog/comparisons/");
}

function isProductHero(hero) {
  return hero?.url.startsWith("/img/products/");
}

function headingLabel(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function headingId(label, index) {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `section-${index}`;
}

function articleBody(markdown) {
  const headings = [];
  const usedIds = new Set();
  const html = renderMarkdown(markdown).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (match, level, contents) => {
    const label = headingLabel(contents);
    const baseId = `article-${headingId(label, headings.length + 1)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    headings.push({ id, label, level });
    return `<h${level} id="${id}">${contents}</h${level}>`;
  });
  return { html, headings };
}

function tableOfContents(headings) {
  if (!headings.length) return "";
  return `<details class="blog-toc"><summary>In this article</summary><nav aria-label="On this page"><ol>${headings
    .map(({ id, label, level }) => `<li class="blog-toc-level-${level}"><a href="#${attr(id)}">${text(label)}</a></li>`)
    .join("")}</ol></nav></details>`;
}

function articleSchema(post, heroUrl = "") {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: authorEntity(post.author),
    image: heroUrl ? `${BASE}${heroUrl}` : `${BASE}/img/og-card.png`,
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
    publisher: ORG,
  };
}

function postPage(post, all) {
  const rt = readingTime(post.body);
  const { html: bodyHtml, headings } = articleBody(post.body);
  const hero = postHero(post);
  const mediaClass = isComparisonHero(hero) ? " blog-hero-media--comparison"
    : isProductHero(hero) ? " blog-hero-media--product" : "";
  const heroImg = hero
    ? `<figure class="blog-hero-media${mediaClass}"><img src="${attr(hero.url)}" alt="${attr(hero.alt)}" width="${hero.size.width}" height="${hero.size.height}" fetchpriority="high" decoding="async"></figure>`
    : "";
  const related = relatedPosts(post, all);
  const relatedHtml = related.length
    ? `<aside class="blog-related"><h2>Related reading</h2><ul>${related
        .map((r) => `<li><a href="..${attr(publicPostPath(r.slug))}"><span class="blog-related-cat">${text(categoryLabel(r.category))}</span> ${text(r.title)}</a></li>`)
        .join("")}</ul></aside>`
    : "";
  const ogImage = hero ? `${BASE}${hero.url}` : `${BASE}/img/og-card.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${text(post.seo_title || SEO_TITLES[post.slug] || post.title)} | MASEST VertKleen</title>
<meta name="description" content="${attr(post.excerpt)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="${attr(post.title)}">
<meta property="og:description" content="${attr(post.excerpt)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="../css/components.css?v=${COMPONENT_VERSION}">
<link rel="stylesheet" href="../css/blog.css?v=${BLOG_VERSION}">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog/${post.slug}">
<meta property="og:url" content="${BASE}/blog/${post.slug}">
<meta property="og:image" content="${attr(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson(articleSchema(post, hero?.url))}</script>
<!-- /seo:auto -->
</head>
<body class="site-soft-bg blog-post-page">
<!-- Reserves the nav's 59px height. chrome.js injects the nav, so without this the
     page paints once without it and again 59px lower: 0.041 CLS, attributed to
     MAIN#main, on every page that lacked it. Height lives in css/style.css. -->
<div id="nav-reserve" aria-hidden="true"></div>
<noscript><style>#nav-reserve{display:none}</style></noscript>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <span>Applications</span>
  <a href="../industries">Industries</a>
  <a href="../proof">Results</a>
  <a href="../resources">SDS &amp; Resources</a>
  <a href="../blog">Blog</a>
</nav>
</noscript>
<main id="main">
  <article class="blog-post wrap">
    <header class="blog-post-header">
      <p class="blog-eyebrow"><a href="../blog">Blog</a> · <span class="blog-cat">${text(categoryLabel(post.category))}</span></p>
      <h1 class="display">${text(post.title)}</h1>
      <p class="blog-lede">${text(post.excerpt)}</p>
      <p class="blog-byline">${post.author ? `${text(post.author)} · ` : ""}${text(fmtDate(post.date))} · ${rt} min read</p>
    </header>
    ${heroImg}
    ${tableOfContents(headings)}
    <div class="blog-body">${bodyHtml}</div>
    ${authorCard(post.author)}
    ${relatedHtml}
    <aside class="blog-hmis-callout">
      <strong>HMIS 0-0-0</strong>
      <p>Industrial cleaning power with HMIS 0-0-0 and non-hazmat shipping. <a href="../blog/hmis-000-explained">Explore the everyday operating benefits</a> or <a href="../resources">find your product documents</a>.</p>
    </aside>
    <aside class="blog-cta">
      <h2>Put the right cleaner to work.</h2>
      <p>Choose a product and available size, then order directly. For equipment, treatment, or application support, explore <a href="../services">MASEST services</a>.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="../products">Shop VertKleen products</a>
        <a class="btn btn-ghost" href="../contact?type=quote">Get project help</a>
        <a class="btn btn-ghost" href="../proof">See field results</a>
      </div>
    </aside>
  </article>
</main>
<script type="module" src="../js/main.js?v=${MAIN_VERSION}"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

function postCard(post) {
  const hero = postHero(post);
  const mediaClass = isComparisonHero(hero) ? " blog-card-img--comparison"
    : isProductHero(hero) ? " blog-card-img--product" : "";
  const thumb = hero
    ? `<img class="blog-card-img${mediaClass}" src="${attr(hero.url)}" alt="${attr(hero.alt)}" width="${hero.size.width}" height="${hero.size.height}" loading="lazy" decoding="async">`
    : `<div class="blog-card-img blog-card-img--fallback" aria-hidden="true"></div>`;
  const tags = (post.tags || []).map((t) => attr(t)).join(" ");
  return `<article class="blog-card" data-slug="${attr(post.slug)}" data-category="${attr(post.category)}" data-tags="${tags}">
    <a class="blog-card-link" href="${attr(publicPostPath(post.slug))}">
      ${thumb}
      <span class="blog-card-cat">${text(categoryLabel(post.category))}</span>
      <h2 class="blog-card-title">${text(post.title)}</h2>
      <p class="blog-card-excerpt">${text(post.excerpt)}</p>
      <span class="blog-card-meta">${text(fmtDate(post.date))} · ${readingTime(post.body)} min read</span>
    </a>
  </article>`;
}

function indexPage(posts) {
  const cats = ["all", ...CATEGORIES];
  const chips = cats
    .map((c) => `<button type="button" class="blog-chip${c === "all" ? " is-active" : ""}" data-filter-cat="${c}" aria-pressed="${c === "all" ? "true" : "false"}" aria-controls="blogPostGrid">${c === "all" ? "All" : text(categoryLabel(c))}</button>`)
    .join("");
  const cards = posts.map(postCard).join("\n");
  const topics = [
    ["descaling", "Descaling"],
    ["degreasing", "Degreasing"],
    ["hvac", "HVAC & water"],
    ["facility-maintenance", "Facility care"],
    ["exterior-cleaning", "Exterior cleaning"],
    ["food-beverage", "Food & beverage"],
  ].filter(([tag]) => posts.some((post) => (post.tags || []).includes(tag)));
  const topicLinks = topics.map(([tag, label]) => `<a href="blog?q=${encodeURIComponent(tag)}">${text(label)}</a>`).join("");
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
<meta name="description" content="Practical cleaning tips, how-to guides, product comparisons, and real VertKleen results for hard commercial and industrial jobs.">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="Blog | MASEST VertKleen">
<meta property="og:description" content="Straight answers and real results for hard cleaning jobs.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="alternate" type="application/rss+xml" title="MASEST VertKleen Blog" href="/blog/feed.xml">
<link rel="stylesheet" href="vendor/phosphor/style.css">
<link rel="stylesheet" href="css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="css/components.css?v=${COMPONENT_VERSION}">
<link rel="stylesheet" href="css/blog.css?v=${BLOG_VERSION}">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/blog">
<meta property="og:url" content="${BASE}/blog">
<meta property="og:image" content="${BASE}/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson(schema)}</script>
<!-- /seo:auto -->
</head>
<body class="site-soft-bg blog-index-page">
<!-- Reserves the nav's 59px height. chrome.js injects the nav, so without this the
     page paints once without it and again 59px lower: 0.041 CLS, attributed to
     MAIN#main, on every page that lacked it. Height lives in css/style.css. -->
<div id="nav-reserve" aria-hidden="true"></div>
<noscript><style>#nav-reserve{display:none}</style></noscript>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="/"><b>MASEST</b></a>
  <a href="products">Products</a>
  <a href="services">Services</a>
  <span>Applications</span>
  <a href="industries">Industries</a>
  <a href="proof">Results</a>
  <a href="resources">SDS &amp; Resources</a>
  <a href="blog">Blog</a>
</nav>
</noscript>
<main id="main">
  <section class="hero blog-index-hero">
    <div class="wrap">
      <span class="eyebrow">Cleaning tips &amp; real results</span>
      <h1 class="display">Clean faster. Keep work moving.</h1>
      <p class="subhead">Practical guides, product comparisons, and field results for crews solving hard cleaning problems.</p>
      <nav class="blog-start-here" aria-label="Start here by topic" data-blog-start-here>
        <span>Start here</span><a href="blog/hmis-000-explained">HMIS 0-0-0</a>${topicLinks}
      </nav>
    </div>
  </section>
  <section class="section">
    <div class="wrap" data-blog-filter>
      <form class="blog-search" role="search" data-blog-search>
        <label for="blogSearch">Search articles</label>
        <div class="blog-search-field">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <input id="blogSearch" name="q" type="search" autocomplete="off" placeholder="Search products, jobs, or problems" aria-describedby="blogResults" aria-controls="blogPostGrid" data-blog-query>
        </div>
        <p id="blogResults" class="blog-results" data-blog-results role="status" aria-live="polite">${posts.length} articles</p>
      </form>
      <div class="blog-chips" role="group" aria-label="Filter by category">${chips}</div>
      <div class="blog-grid" id="blogPostGrid">
${cards}
      </div>
      <p class="blog-empty" hidden>Try fewer words or a different category.</p>
    </div>
  </section>
  <section class="block-dark on-dark cta-band">
    <div class="wrap reveal">
      <h2 class="headline">Need a direct path?</h2>
      <p class="subhead">Shop VertKleen products, get help with a project, or review the resources that support your team.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="products">Shop VertKleen products</a>
        <a class="btn btn-ghost" href="contact?type=quote">Get project help</a>
        <a class="btn btn-ghost" href="resources">SDS &amp; resources</a>
      </div>
    </div>
  </section>
  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="blog" data-cms-region="body"></div>
</main>
<script type="module" src="js/main.js?v=${MAIN_VERSION}"></script>
<script type="module" src="js/blog-index.js?v=${MAIN_VERSION}"></script>
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

// <guid> stays on the original /blog/ permalink even for a retired post: it is an
// identifier, and changing it would re-deliver the item to every existing subscriber as
// though it were new. <link> moves to the canonical URL so a click skips the 301.
function feedXml(posts) {
  const items = posts.map((p) => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${BASE}${publicPostPath(p.slug)}</link>
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
    <description>Practical cleaning tips, real VertKleen results, and easier ways to handle hard jobs.</description>
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
    ...posts
      .filter((p) => !REDIRECTED_POST_URLS.has(p.slug))
      .map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastmod: p.date, changefreq: "monthly", priority: "0.6" })),
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
