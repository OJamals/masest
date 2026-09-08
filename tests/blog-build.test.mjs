import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync, mkdtempSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_TYPE_DEFINITIONS, snapshotGroups, structuredPayloadKeys } from "../js/content-types.js";
import { snapshotPayloads } from "../tools/build-content.mjs";
import { buildBlog } from "../tools/build-blog.mjs";
import { escapeHtml } from "../tools/_md.mjs";
import { organizationJsonLd } from "../tools/company-identity.mjs";
import { filterBlogPosts } from "../js/blog-index.js";

const SEED = JSON.parse(readFileSync(new URL("../data/content/blog.json", import.meta.url), "utf8"));
const BLOG_CSS = readFileSync(new URL("../css/blog.css", import.meta.url), "utf8");
const internalContentLinks = (markdown) => [...String(markdown).matchAll(/\]\((\/[^)\s]+)/g)]
  .map((match) => match[1])
  .filter((url) => !url.startsWith("/img/"));
const publicHeroPath = (hero) => {
  if (hero.startsWith("/")) return hero;
  const path = new URL(hero).pathname;
  return `/img/${path.split("/site/img/")[1]}`;
};
const P3_AUTHORITY_POSTS = [
  {
    slug: "industrial-cleaning-trial-scope-isolate-contain-release",
  },
  {
    slug: "food-plant-cleaning-cip-sanitation-release",
  },
  {
    slug: "cooling-tower-cleaning-water-management-plan",
  },
];
const SEO_INTENT_POSTS = [
  {
    slug: "how-to-descale-heat-exchanger",
    hero: "/img/blog/heat-exchanger-descaling-hero.webp",
    diagram: "/img/blog/diagrams/heat-exchanger-loop.svg",
    product: "HCR",
    links: [
      "/products/hcr",
      "/industries/hvac-water",
      "/blog/hcr-brevard-hvac-rust-case-study",
    ],
  },
  {
    slug: "warehouse-floor-degreasing-guide",
    hero: "/img/blog/warehouse-floor-degreasing-hero.webp",
    diagram: "/img/blog/diagrams/warehouse-floor-cycle.svg",
    product: "CR HD",
    links: [
      "/products/crhd",
      "/industries/distribution-cold-storage",
      "/blog/cr-hd-walmart-distribution-center-case-study",
    ],
  },
  {
    slug: "commercial-kitchen-degreasing-guide",
    hero: "/img/blog/commercial-kitchen-degreasing-hero.webp",
    diagram: "/img/proof/story/kitchen-grease-after-aligned-202609.webp",
    product: "CR HD",
    links: [
      "/products/crhd",
      "/industries/restaurants-commercial-kitchens",
      "/proof#commercial-kitchen-crhd",
    ],
  },
  {
    slug: "how-to-clean-oxidized-aluminum-boat",
    hero: "/img/blog/aluminum-boat-cleaning-hero.webp",
    diagram: "/img/blog/diagrams/aluminum-boat-cleaning-cycle.svg",
    product: "AlumiBrite",
    links: [
      "/products/alumibrite",
      "/products/torque",
      "/industries/marine",
      "/proof#airboat-alumibrite",
    ],
  },
  {
    slug: "commercial-gym-cleaning-checklist",
    hero: "/img/blog/commercial-gym-cleaning-hero.webp",
    diagram: "/img/blog/diagrams/commercial-gym-cleaning-zones.svg",
    product: "Purgo",
    links: [
      "/products/purgo",
      "/products/multiwash",
      "/products",
    ],
  },
  {
    slug: "car-dealership-cleaning-checklist",
    hero: "/img/blog/car-dealership-cleaning-hero.webp",
    diagram: "/img/blog/diagrams/car-dealership-cleaning-zones.svg",
    product: "CRHD",
    links: [
      "/products/crhd",
      "/products/torque",
      "/products/alumibrite",
      "/industries/fleet-trucking-car-washes",
    ],
  },
  {
    slug: "watersafe60-water-treatment-guide",
    hero: "/img/blog/watersafe60-water-treatment-hero.webp",
    diagram: "/img/blog/diagrams/watersafe60-job-plan.svg",
    product: "WaterSafe60",
    links: [
      "/products/watersafe60",
      "/industries/municipalities-water-utilities",
      "/industries/mechanical-contractors-water-treatment",
      "/proof#watersafe60-nsf60",
    ],
  },
  {
    slug: "drone-building-cleaning-guide",
    hero: "/img/industries/tasks/drone-cleaning-companies-01.webp",
    diagram: "/img/blog/diagrams/drone-building-cleaning-plan.svg",
    product: "MultiWash",
    links: [
      "/products/multiwash",
      "/industries/drone-cleaning-companies",
      "/proof#uf-shands-drone-wash",
    ],
  },
  {
    slug: "descaler-fire-pump-walmart-case-study",
    hero: "/img/blog/descaler-fire-pump-case-hero.webp",
    diagram: "/img/blog/diagrams/fire-pump-descaling-timeline.svg",
    product: "Descaler",
    links: [
      "/products/descaler",
      "/industries/plumbing",
      "/proof#fire-pump-descaler",
    ],
  },
  {
    slug: "hvac-condensate-drain-line-cleaning-guide",
    hero: "/img/blog/hvac-drain-line-cleaning-hero.webp",
    diagram: "/img/blog/diagrams/hvac-drain-cleaning-route.svg",
    product: "HVAC CR",
    links: [
      "/products/cr2",
      "/products/descaler",
      "/industries/hvac-water",
      "/proof#cr2-caustic-replacement",
    ],
  },
  {
    slug: "neutral-ph-industrial-degreaser-guide",
    hero: "/img/blog/neutral-ph-industrial-degreaser-hero.webp",
    diagram: "/img/blog/diagrams/neutral-degreaser-dilution-guide.svg",
    product: "Neutral",
    links: [
      "/products/neutral",
      "/industries/food-beverage",
      "/industries/aviation-fbos-mro-airports",
    ],
  },
  {
    slug: "how-to-remove-moss-algae-without-pressure-washing",
    hero: "/img/blog/lam3-moss-algae-cleaning-hero.webp",
    diagram: "/img/blog/diagrams/lam3-spray-walk-away-plan.svg",
    product: "LAM3",
    links: [
      "/products/lam3",
      "/industries/drone-cleaning-companies",
      "/proof#property-grout-moss",
      "/blog/lam3-vs-wet-forget",
    ],
  },
  {
    slug: "low-foam-degreaser-parts-washers-floor-scrubbers",
    hero: "/img/blog/low-foam-parts-washer-hero.webp",
    diagram: "/img/blog/diagrams/low-foam-wash-equipment-plan.svg",
    product: "CR HD Low Foam",
    links: [
      "/products/cr-hd-low-foam",
      "/industries/manufacturing",
      "/blog/warehouse-floor-degreasing-guide",
      "/proof",
    ],
  },
  {
    slug: "commercial-drain-odor-control-guide",
    hero: "/img/blog/commercial-drain-odor-control-hero.webp",
    diagram: "/img/blog/diagrams/commercial-drain-odor-route.svg",
    product: "Purgo",
    links: [
      "/products/purgo",
      "/industries/restaurants-commercial-kitchens",
      "/industries/hotels-property-management",
    ],
  },
];

test("blog_post content type is registered", () => {
  const def = CONTENT_TYPE_DEFINITIONS.blog_post;
  assert.ok(def, "blog_post must be defined");
  assert.equal(def.snapshot.file, "blog.json");
  assert.equal(def.snapshot.key, "blog_posts");
  const keys = def.fields.map((f) => f.key);
  for (const req of ["title", "category", "date", "excerpt", "body"]) {
    assert.ok(keys.includes(req), `field ${req} must exist`);
  }
});

test("blog index keeps start-here navigation and first results close to the hero", () => {
  assert.match(BLOG_CSS, /\.blog-index-hero \{ padding:\s*clamp\(24px, 3vw, 36px\) 0 clamp\(16px, 2vw, 24px\); \}/);
  assert.match(BLOG_CSS, /\.blog-index-hero \+ \.section \{ padding-top:\s*clamp\(20px, 2\.5vw, 32px\); \}/);
  assert.match(BLOG_CSS, /\.blog-start-here/);
  assert.match(BLOG_CSS, /\.blog-card-img--comparison[\s\S]*object-fit:\s*contain/);
  assert.match(BLOG_CSS, /\.blog-body p:has\(> img:only-child\)/);
  assert.doesNotMatch(BLOG_CSS, /\[width="367"\]/);
});

test("blog_post fields are in the structured payload key set", () => {
  const keys = structuredPayloadKeys();
  assert.ok(keys.has("category"));
  assert.ok(keys.has("body"));
  assert.ok(keys.has("excerpt"));
});

test("snapshotGroups maps blog_post -> blog.json/blog_posts", () => {
  const group = snapshotGroups().find((g) => g.file === "blog.json");
  assert.ok(group, "blog.json snapshot group must exist");
  assert.deepEqual(group.types.map((t) => [t.type, t.key]), [["blog_post", "blog_posts"]]);
});

test("snapshotPayloads emits a blog.json payload keyed blog_posts", () => {
  const entries = [{
    type: "blog_post", slug: "hello-world", title: "Hello World", status: "published",
    payload: { category: "news", excerpt: "x", body: "# Hi", date: "2026-07-07" }, seo: {},
  }];
  const payloads = snapshotPayloads(entries);
  assert.ok(payloads["blog.json"], "blog.json payload must exist");
  assert.equal(payloads["blog.json"].blog_posts[0].slug, "hello-world");
  assert.equal(payloads["blog.json"].blog_posts[0].category, "news");
});

test("buildBlog writes a static page per post", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    for (const p of SEED.blog_posts) {
      const file = join(out, "blog", `${p.slug}.html`);
      assert.ok(existsSync(file), `${p.slug}.html must exist`);
      const html = readFileSync(file, "utf8");
      const expectedTitle = escapeHtml(p.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(html, new RegExp(`<h1[^>]*>${expectedTitle}`));
      assert.match(html, /"@type":"BlogPosting"/);
      assert.match(html, new RegExp(`canonical" href="https://masest.co/blog/${p.slug}"`));
      assert.match(html, /href="\.\.\/css\/blog\.css\?v=\d{8}[a-z]"/);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("buildBlog removes post pages absent from the published snapshot", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  const [current, stale] = SEED.blog_posts;
  try {
    buildBlog({ posts: [current, stale], outDir: out, updateSitemap: false });
    const staleFile = join(out, "blog", `${stale.slug}.html`);
    assert.ok(existsSync(staleFile));

    buildBlog({ posts: [current], outDir: out, updateSitemap: false });
    assert.equal(existsSync(staleFile), false);
    assert.ok(existsSync(join(out, "blog", `${current.slug}.html`)));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("production build regenerates blog outputs after refreshing CMS snapshots", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.prebuild, /npm run build:blog/);
});

test("P3 authority posts connect products to practical outcomes in plain language", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    for (const expected of P3_AUTHORITY_POSTS) {
      const post = SEED.blog_posts.find(({ slug }) => slug === expected.slug);
      assert.ok(post, `${expected.slug} must exist in the Blog CMS snapshot`);
      assert.equal(post.category, "technical");
      assert.equal(post.author, "MASEST Team");
      assert.ok(post.tags.includes("operations"));
      assert.ok(post.body.trim().length > 280, `${expected.slug} must retain a substantive article body`);
      const links = internalContentLinks(post.body);
      assert.ok(links.length >= 3, `${expected.slug} must retain useful internal reading links`);
      assert.ok(links.some((link) => /^\/(products|proof|resources|programs|industries)/.test(link)), `${expected.slug} must link to a supporting resource`);
      assert.ok(links.some((link) => link.startsWith("/contact?")), `${expected.slug} must retain a direct help path`);

      const html = readFileSync(join(out, "blog", `${expected.slug}.html`), "utf8");
      assert.match(html, /<h2>/);
      for (const link of links) {
        assert.ok(html.includes(`href="${escapeHtml(link)}"`), `${expected.slug} must render ${link}`);
      }
      assert.doesNotMatch(
        html,
        /safe to discharge|guarantees? compliance|VertKleen WaterSafe60 is NSF|EPA-registered VertKleen/i,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("SEO intent posts connect buyer searches to products, proof, and trial CTAs", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    for (const expected of SEO_INTENT_POSTS) {
      const post = SEED.blog_posts.find(({ slug }) => slug === expected.slug);
      assert.ok(post, `${expected.slug} must exist in the Blog CMS snapshot`);
      assert.equal(post.hero, expected.hero);
      assert.ok(post.body.includes(expected.diagram));
      assert.ok(post.body.trim().length > 280, `${expected.slug} must retain a substantive article body`);
      const links = internalContentLinks(post.body);
      assert.ok(links.some((link) => link.startsWith("/products")), `${expected.slug} must link to a product`);
      assert.ok(new Set(links).size >= 2, `${expected.slug} must retain more than one useful destination`);
      assert.ok(links.some((link) => link.startsWith("/contact?")), `${expected.slug} must retain a direct help path`);

      const html = readFileSync(join(out, "blog", `${expected.slug}.html`), "utf8");
      assert.ok(html.includes(`src="${expected.hero}"`));
      assert.ok(html.includes(`src="${expected.diagram}"`));
      for (const link of links) assert.ok(html.includes(`href="${escapeHtml(link)}"`), `${expected.slug} must render ${link}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("published blog prose stays human, concise, and free of legal-style disclaimers", () => {
  const banned = [
    /evidence boundary/i,
    /what this .*proves/i,
    /not a (?:laboratory|controlled)/i,
    /universal (?:result|cycle) promise/i,
    /record supports/i,
    /not a direct test/i,
    /operating burden/i,
    /acceptance endpoint/i,
    /verified restart/i,
  ];

  for (const post of SEED.blog_posts) {
    const prose = `${post.title}\n${post.excerpt}\n${post.body}`;
    for (const pattern of banned) {
      assert.doesNotMatch(prose, pattern, `${post.slug} should avoid ${pattern}`);
    }

    assert.ok(post.excerpt.length <= 220, `${post.slug} excerpt should stay scannable on index cards`);
  }
});

test("P3 authority posts have an idempotent Blog CMS seed", () => {
  const seed = readFileSync(
    new URL("../supabase/seed-blog-authority-posts.sql", import.meta.url),
    "utf8",
  );
  const payloads = [...seed.matchAll(/\$post\$([\s\S]*?)\$post\$::jsonb/g)]
    .map((match) => JSON.parse(match[1]));
  assert.equal(payloads.length, P3_AUTHORITY_POSTS.length);
  for (const expected of P3_AUTHORITY_POSTS) {
    const post = SEED.blog_posts.find(({ slug }) => slug === expected.slug);
    const payload = payloads.find(({ title }) => title === post.title);
    for (const key of ["title", "body", "date", "hero", "tags", "author", "excerpt", "category", "hero_alt"]) {
      assert.ok(payload[key], `${expected.slug} seed must retain ${key}`);
    }
    assert.equal(payload.category, post.category);
    assert.equal(payload.author, post.author);
    assert.ok(internalContentLinks(payload.body).length >= 3, `${expected.slug} seed must retain useful internal links`);
    assert.match(seed, new RegExp(`'blog_post',\\s*'${expected.slug}'`));
    assert.ok(seed.includes(post.title));
    assert.ok(seed.includes(post.excerpt));
  }
  assert.match(seed, /on conflict \(type, slug, locale\) do update/);
  assert.match(seed, /where type = 'blog_post' and slug in \(/);
});

test("buildBlog rejects an invalid category", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    assert.throws(() => buildBlog({
      posts: [{ slug: "x", title: "X", category: "bogus", date: "2026-01-01", excerpt: "e", body: "b" }],
      outDir: out, updateSitemap: false,
    }), /category/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("buildBlog rejects a missing required field", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    assert.throws(() => buildBlog({
      posts: [{ slug: "x", category: "news", date: "2026-01-01", excerpt: "e", body: "b" }],
      outDir: out, updateSitemap: false,
    }), /title/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("buildBlog writes an index listing every post with filter data", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const idx = readFileSync(join(out, "blog.html"), "utf8");
    for (const p of SEED.blog_posts) {
      assert.ok(idx.includes(`data-slug="${p.slug}"`), `${p.slug} card must render`);
      assert.ok(idx.includes(`data-category="${p.category}"`), `${p.slug} category attr`);
    }
    assert.match(idx, /data-blog-filter/);
    assert.match(idx, /role="search" data-blog-search/);
    assert.match(idx, /type="search"[^>]+data-blog-query/);
    assert.match(idx, /data-blog-results[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(idx, /id="blogPostGrid"/);
    assert.match(idx, /data-cms-page="blog"/);
    assert.match(idx, /canonical" href="https:\/\/masest\.co\/blog"/);
    assert.ok(idx.includes(JSON.stringify(organizationJsonLd())));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("blog discovery combines category and tokenized text search", () => {
  const posts = [
    { title: "Heat Exchanger Descaling", excerpt: "Remove mineral scale safely", category: "technical", tags: ["HVAC", "HCR"] },
    { title: "Warehouse Floor Guide", excerpt: "Oil and grease removal", category: "how-to", tags: ["CR HD"] },
  ];

  assert.deepEqual(filterBlogPosts(posts, { category: "technical", query: "scale HCR" }), [posts[0]]);
  assert.deepEqual(filterBlogPosts(posts, { category: "all", query: "GREASE floor" }), [posts[1]]);
  assert.deepEqual(filterBlogPosts(posts, { category: "how-to", query: "scale" }), []);
  assert.deepEqual(filterBlogPosts(posts), posts);
});

test("buildBlog writes a well-formed RSS feed", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const feed = readFileSync(join(out, "blog", "feed.xml"), "utf8");
    assert.match(feed, /<rss version="2.0">/);
    assert.match(feed, /<channel>/);
    const items = feed.match(/<item>/g) || [];
    assert.equal(items.length, SEED.blog_posts.length);
    assert.match(feed, /<link>https:\/\/masest\.co\/blog\/hmis-000-explained<\/link>/);
    assert.ok(!/<description>[^<]*<[^/]/.test(feed));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("mergeSitemap inserts blog urls idempotently", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    const sm = join(out, "sitemap.xml");
    wf(sm, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://masest.co/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>https://masest.co/blog</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n  <url><loc>https://masest.co/resources</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n</urlset>\n`);
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: true });
    let xml = readFileSync(sm, "utf8");
    assert.match(xml, /https:\/\/masest\.co\/blog<\/loc>/);
    assert.match(xml, /https:\/\/masest\.co\/blog\/hmis-000-explained<\/loc>/);
    assert.match(xml, /<loc>https:\/\/masest\.co\/blog\/hmis-000-explained<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    assert.ok(xml.indexOf("https://masest.co/blog</loc>") < xml.indexOf("https://masest.co/resources</loc>"));
    const firstCount = (xml.match(/\/blog\/hmis-000-explained</g) || []).length;
    const firstXml = xml;
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: true });
    xml = readFileSync(sm, "utf8");
    assert.equal((xml.match(/\/blog\/hmis-000-explained</g) || []).length, firstCount);
    assert.equal(xml, firstXml);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("JSON-LD escapes '<' so a CMS title can't break out of the script block", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    const evil = "Break </script><img src=x onerror=alert(1)> Out";
    buildBlog({
      posts: [{ slug: "evil", title: evil, category: "news", date: "2026-01-01",
        excerpt: "</script> in excerpt too", body: "b", author: "</script>", hero: "", hero_alt: "" }],
      outDir: out, updateSitemap: false,
    });
    const html = readFileSync(join(out, "blog", "evil.html"), "utf8");
    // The ld+json block must contain no raw "<" (all escaped to <),
    // so the author's "</script>" cannot terminate the script element.
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.ok(!block.includes("<"), "JSON-LD must not contain a raw '<'");
    assert.match(block, /\\u003c\/script/);
    // And it round-trips: unescaping < yields valid JSON with the real title.
    const parsed = JSON.parse(block.replace(/\\u003c/g, "<"));
    assert.equal(parsed.headline, evil);
    // No injected <img> leaked into raw page HTML from the title.
    assert.ok(!html.includes("<img src=x onerror"), "no injected img from title");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("index filters expose pressed state, controlled grid, and one live result status", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const idx = readFileSync(join(out, "blog.html"), "utf8");
    // "All" chip starts pressed; category chips start unpressed.
    assert.match(idx, /data-filter-cat="all" aria-pressed="true"/);
    assert.match(idx, /data-filter-cat="technical" aria-pressed="false"/);
    assert.match(idx, /data-filter-cat="all"[^>]+aria-controls="blogPostGrid"/);
    assert.match(idx, /data-blog-results[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(idx, /class="blog-empty"[^>]+hidden/);
    assert.doesNotMatch(idx, /class="blog-empty"[^>]+role="status"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("blog foundation provides topic discovery, reading time, and direct help paths", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const index = readFileSync(join(out, "blog.html"), "utf8");
    assert.match(index, /data-blog-start-here/);
    assert.match(index, /href="blog\?q=descaling">Descaling/);
    assert.match(index, /href="blog\?q=degreasing">Degreasing/);
    assert.match(index, /href="products">Shop VertKleen products/);
    assert.match(index, /href="contact\?type=quote">Get project help/);
    assert.match(index, /href="resources">SDS &amp; resources/);
    assert.match(index, /blog-card-meta">[\s\S]*min read/);

    const post = readFileSync(join(out, "blog", "hmis-000-explained.html"), "utf8");
    assert.match(post, /class="blog-lede">/);
    assert.match(post, /class="blog-hmis-callout"[\s\S]*HMIS 0-0-0 and non-hazmat shipping/);
    assert.match(post, /href="\.\.\/blog\/hmis-000-explained">Explore the everyday operating benefits/);
    assert.match(post, /href="\.\.\/resources">find your product documents/);
    assert.match(post, /class="btn btn-primary" href="\.\.\/products">Shop VertKleen products/);
    assert.match(post, /class="btn btn-ghost" href="\.\.\/contact\?type=quote">Get project help/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("blog post contents expose stable heading anchors and topic-first related reading", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  const posts = [
    {
      slug: "anchor-guide", title: "Anchor guide", category: "technical", date: "2026-03-03",
      excerpt: "A focused guide.", tags: ["descaling"],
      body: "## A\n\nStart with the circuit.\n\n### A\n\nConfirm access.\n\n## A-2\n\nA suffix collision stays unique.",
    },
    {
      slug: "shared-topic", title: "Shared topic", category: "news", date: "2026-03-02",
      excerpt: "Shares the descaling topic.", tags: ["descaling"], body: "## Shared topic\n\nUseful reading.",
    },
    {
      slug: "same-category", title: "Same category", category: "technical", date: "2026-03-01",
      excerpt: "Only shares the category.", tags: ["warehouse"], body: "## Same category\n\nUseful reading.",
    },
  ];
  try {
    buildBlog({ posts, outDir: out, updateSitemap: false });
    const html = readFileSync(join(out, "blog", "anchor-guide.html"), "utf8");
    assert.match(html, /<details class="blog-toc"><summary>In this article<\/summary><nav aria-label="On this page">/);
    assert.doesNotMatch(html, /<details class="blog-toc" open>/);
    assert.match(html, /href="#article-a">A/);
    assert.match(html, /href="#article-a-2">A/);
    assert.match(html, /href="#article-a-2-2">A-2/);
    assert.match(html, /<h2 id="article-a">A<\/h2>/);
    assert.match(html, /<h3 id="article-a-2">A<\/h3>/);
    assert.match(html, /<h2 id="article-a-2-2">A-2<\/h2>/);
    assert.ok(html.indexOf("Shared topic") < html.indexOf("Same category"), "shared topic must outrank category-only reading");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a hero renders as the card thumbnail and post hero figure; empty falls back", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: [
      { slug: "with-hero", title: "With Hero", category: "news", date: "2026-02-02",
        excerpt: "e", body: "b", hero: "/img/blog/descaling-without-acid.webp?v=20260725", hero_alt: "a coil" },
      { slug: "no-hero", title: "No Hero", category: "news", date: "2026-01-01",
        excerpt: "e", body: "b", hero: "", hero_alt: "" },
    ], outDir: out, updateSitemap: false });
    const idx = readFileSync(join(out, "blog.html"), "utf8");
    // card with hero -> <img>, alt from hero_alt
    assert.match(idx, /<img class="blog-card-img" src="\/img\/blog\/descaling-without-acid\.webp\?v=20260725" alt="a coil"/);
    // card without hero -> gradient fallback div
    assert.match(idx, /class="blog-card-img blog-card-img--fallback"/);
    // post page with hero -> hero figure
    const post = readFileSync(join(out, "blog", "with-hero.html"), "utf8");
    assert.match(post, /<figure class="blog-hero-media"><img src="\/img\/blog\/descaling-without-acid\.webp\?v=20260725" alt="a coil"/);
    // post without hero -> no hero figure
    const post2 = readFileSync(join(out, "blog", "no-hero.html"), "utf8");
    assert.ok(!post2.includes("blog-hero-media"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("comparison posts use the CMS-selected hero and alt text", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  const comparisonSlugs = new Set([
    "vertkleen-hcr-vs-clr",
    "hcr-vs-rydlyme",
    "cr-hd-vs-simple-green",
    "lam3-vs-wet-forget",
    "beer-line-cleaner-cost-comparison",
  ]);
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const index = readFileSync(join(out, "blog.html"), "utf8");
    for (const postData of SEED.blog_posts.filter(({ slug }) => comparisonSlugs.has(slug))) {
      const src = publicHeroPath(postData.hero);
      assert.match(index, new RegExp(`src="${src}" alt="${escapeHtml(postData.hero_alt)}"`));
      const post = readFileSync(join(out, "blog", `${postData.slug}.html`), "utf8");
      assert.match(post, new RegExp(`src="${src}" alt="${escapeHtml(postData.hero_alt)}"`));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("CMS comparison packshots fill their media regions without changing the selected image", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  const hero = "/img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp";
  try {
    buildBlog({ posts: [{
      slug: "cms-comparison", title: "CMS comparison", category: "technical", date: "2026-02-03",
      excerpt: "e", body: "## Compare\n\nA real packshot.", hero, hero_alt: "Comparison packshot",
    }], outDir: out, updateSitemap: false });
    const index = readFileSync(join(out, "blog.html"), "utf8");
    const post = readFileSync(join(out, "blog", "cms-comparison.html"), "utf8");
    assert.match(index, new RegExp(`<img class="blog-card-img blog-card-img--comparison" src="${hero}" alt="Comparison packshot"`));
    assert.match(post, new RegExp(`<figure class="blog-hero-media blog-hero-media--comparison"><img src="${hero}" alt="Comparison packshot"`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a managed CMS hero resolves to its public site-image path", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: [{
      slug: "managed-hero",
      title: "Managed Hero",
      category: "news",
      date: "2026-02-03",
      excerpt: "e",
      body: "b",
      hero: "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/products/crhd-studio.webp",
      hero_alt: "CR HD container",
    }], outDir: out, updateSitemap: false });

    const index = readFileSync(join(out, "blog.html"), "utf8");
    const post = readFileSync(join(out, "blog", "managed-hero.html"), "utf8");
    assert.match(index, /src="\/img\/products\/crhd-studio\.webp" alt="CR HD container"/);
    assert.match(post, /src="\/img\/products\/crhd-studio\.webp" alt="CR HD container"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a missing CMS hero falls back without aborting the blog publish", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: [{
      slug: "missing-hero",
      title: "Missing Hero",
      category: "news",
      date: "2026-02-03",
      excerpt: "e",
      body: "b",
      hero: "/img/proof/cases/removed.webp",
      hero_alt: "Removed proof image",
    }], outDir: out, updateSitemap: false });

    const index = readFileSync(join(out, "blog.html"), "utf8");
    const post = readFileSync(join(out, "blog", "missing-hero.html"), "utf8");
    assert.match(index, /class="blog-card-img blog-card-img--fallback"/);
    assert.ok(!post.includes("blog-hero-media"));
    assert.match(post, /<meta property="og:image" content="https:\/\/masest\.co\/img\/og-card\.png">/);
    assert.match(post, /"image":"https:\/\/masest\.co\/img\/og-card\.png"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("Walmart CR HD case leads with the customer story and renders its decision tools", () => {
  const slug = "cr-hd-walmart-distribution-center-case-study";
  const post = SEED.blog_posts.find((entry) => entry.slug === slug);
  const comparison = SEED.blog_posts.find((entry) => entry.slug === "cr-hd-vs-simple-green");
  assert.ok(post, "Walmart CR HD case must exist in the Blog CMS snapshot");
  assert.ok(comparison, "CR HD comparison must exist in the Blog CMS snapshot");
  assert.equal(post.category, "technical");
  assert.equal(post.author, "MASEST Team");
  assert.ok(post.tags.includes("warehouse"));
  assert.ok(post.tags.includes("cr-hd"));
  for (const site of ["DC-8851", "DC-7023", "DC-6099"]) assert.ok(post.body.includes(site));
  assert.match(post.body, /(?:replaced|switched from) Simple Green/i);
  assert.match(post.body, /50% degreaser, compared with 15% active for Simple Green/);
  assert.match(post.body, /Crown Forklift and Plug Power equipment/);
  assert.match(post.body, /HMIS 0-0-0/);
  assert.doesNotMatch(post.body, /\$10,000|Descaler plumbing|savings claim/i);
  assert.doesNotMatch(post.body, /generated, unbranded warehouse trial illustration/i);
  assert.ok(!post.body.includes("/img/blog/cases/cr-hd-walmart-forklift-area.webp"));
  assert.ok(!post.body.includes("/img/blog/cases/cr-hd-walmart-crown-fleet.webp"));
  assert.doesNotMatch(post.body, /documented purchasing and operating savings/i);
  assert.ok(comparison.body.includes(`](/blog/${slug})`));
  assert.doesNotMatch(comparison.body, /documented purchasing and operating savings/i);

  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const html = readFileSync(join(out, "blog", `${slug}.html`), "utf8");
    assert.ok((html.match(/<table>/g) || []).length >= 1, "case study must retain a decision table");
    assert.match(html, /src="\/img\/blog\/warehouse-degreasing-trial-hero\.webp"[^>]+width="1440" height="810"/);
    assert.match(html, /src="\/img\/blog\/cases\/cr-hd-walmart-product-field\.webp"[^>]+width="367" height="670"/);
    assert.match(html, /src="\/img\/blog\/diagrams\/warehouse-degreasing-trial\.svg"[^>]+width="1200" height="675"/);
    assert.match(html, /"image":"https:\/\/masest\.co\/img\/blog\/warehouse-degreasing-trial-hero\.webp"/);
    assert.match(html, /href="\/contact\?type=sample&amp;product=CR%20HD#quoteForm"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
