import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync, mkdtempSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_TYPE_DEFINITIONS, snapshotGroups, structuredPayloadKeys } from "../js/content-types.js";
import { snapshotPayloads } from "../tools/build-content.mjs";
import { buildBlog } from "../tools/build-blog.mjs";
import { escapeHtml } from "../tools/_md.mjs";

const SEED = JSON.parse(readFileSync(new URL("../data/content/blog.json", import.meta.url), "utf8"));
const P3_AUTHORITY_POSTS = [
  {
    slug: "industrial-cleaning-trial-scope-isolate-contain-release",
    outcome: "total job cost",
    links: [
      "/products",
      "/proof",
      "/resources",
    ],
  },
  {
    slug: "food-plant-cleaning-cip-sanitation-release",
    outcome: "time until production restarts",
    links: [
      "/proof#brewery-cip-trials",
      "/resources",
      "/pricing-cip-food-beverage",
    ],
  },
  {
    slug: "cooling-tower-cleaning-water-management-plan",
    outcome: "total shutdown time",
    links: [
      "/programs",
      "/products",
      "/proof",
    ],
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
    diagram: "/img/blog/diagrams/commercial-kitchen-degreasing-cycle.svg",
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
      "/industries/marine-marinas-boatyards",
      "/proof#airboat-alumibrite",
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
      assert.equal(post.author, "MASEST Technical Team");
      assert.ok(post.tags.includes("operations"));
      assert.ok(post.body.includes(expected.outcome), `${expected.slug} must name ${expected.outcome}`);
      for (const link of expected.links) {
        assert.ok(post.body.includes(`](${link})`), `${expected.slug} must link ${link}`);
      }

      const html = readFileSync(join(out, "blog", `${expected.slug}.html`), "utf8");
      assert.match(html, /<h2>/);
      for (const link of expected.links) {
        assert.ok(html.includes(`href="${link}"`), `${expected.slug} must render ${link}`);
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
      assert.ok(post.body.includes(expected.product));
      assert.match(post.body, /HMIS 0-0-0/);
      assert.match(post.body, /\[Plan my .+\]\(\/contact\?type=audit/);
      for (const link of expected.links) {
        assert.ok(
          post.body.includes(`](${link})`) || post.body.includes(`href=${link}`),
          `${expected.slug} must link ${link}`,
        );
      }

      const html = readFileSync(join(out, "blog", `${expected.slug}.html`), "utf8");
      assert.ok(html.includes(`src="${expected.hero}"`));
      assert.ok(html.includes(`src="${expected.diagram}"`));
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
    /does not (?:report|depict|turn|remove|replace)/i,
    /still govern/i,
    /operating burden/i,
    /acceptance endpoint/i,
    /verified restart/i,
  ];

  for (const post of SEED.blog_posts) {
    const prose = `${post.title}\n${post.excerpt}\n${post.body}`;
    assert.match(prose, /HMIS 0-0-0/, `${post.slug} should keep the shared product-line advantage visible`);
    for (const pattern of banned) {
      assert.doesNotMatch(prose, pattern, `${post.slug} should avoid ${pattern}`);
    }

    const paragraphs = post.body.split(/\n\n+/).filter((part) => (
      part
      && !part.startsWith("## ")
      && !part.startsWith("|")
      && !part.startsWith("[[")
      && !part.startsWith("![")
    ));
    for (const paragraph of paragraphs) {
      assert.ok(paragraph.length <= 240, `${post.slug} paragraph should stay under 240 characters`);
    }
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
    assert.deepEqual(payload, {
      title: post.title,
      body: post.body,
      date: post.date,
      hero: post.hero,
      tags: post.tags,
      author: post.author,
      excerpt: post.excerpt,
      category: post.category,
      hero_alt: post.hero_alt,
    });
    assert.match(seed, new RegExp(`'blog_post',\\s*'${expected.slug}'`));
    assert.ok(seed.includes(post.title));
    assert.ok(seed.includes(post.excerpt));
    assert.ok(seed.includes(expected.outcome));
    for (const link of expected.links) assert.ok(seed.includes(`](${link})`));
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
    assert.match(idx, /data-cms-page="blog"/);
    assert.match(idx, /canonical" href="https:\/\/masest\.co\/blog"/);
    assert.match(idx, /"brand":"VertKleen"/);
    assert.match(idx, /"contactPoint":\{"@type":"ContactPoint","contactType":"sales","url":"https:\/\/masest\.co\/contact"\}/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
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

test("index chips expose aria-pressed and the empty state is a live region", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const idx = readFileSync(join(out, "blog.html"), "utf8");
    // "All" chip starts pressed; category chips start unpressed.
    assert.match(idx, /data-filter-cat="all" aria-pressed="true"/);
    assert.match(idx, /data-filter-cat="technical" aria-pressed="false"/);
    // Empty state announces to assistive tech.
    assert.match(idx, /class="blog-empty" role="status" aria-live="polite"/);
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

test("protected comparison posts use durable split-product heroes", () => {
  const out = mkdtempSync(join(tmpdir(), "blog-"));
  const expected = [
    "vertkleen-hcr-vs-clr",
    "hcr-vs-rydlyme",
    "cr-hd-vs-simple-green",
    "lam3-vs-wet-forget",
    "beer-line-cleaner-cost-comparison",
  ];
  try {
    buildBlog({ posts: SEED.blog_posts, outDir: out, updateSitemap: false });
    const index = readFileSync(join(out, "blog.html"), "utf8");
    for (const slug of expected) {
      const src = `/img/blog/comparisons/${slug}-split.webp`;
      assert.ok(existsSync(new URL(`../img/blog/comparisons/${slug}-split.webp`, import.meta.url)));
      assert.match(index, new RegExp(`src="${src}"[^>]+width="1448" height="1086"`));
      const post = readFileSync(join(out, "blog", `${slug}.html`), "utf8");
      assert.match(post, new RegExp(`src="${src}"[^>]+width="1448" height="1086"`));
    }
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
  assert.equal(post.author, "MASEST Technical Team");
  assert.ok(post.tags.includes("warehouse"));
  assert.ok(post.tags.includes("cr-hd"));
  for (const site of ["DC-8851", "DC-7023", "DC-6099"]) assert.ok(post.body.includes(site));
  assert.match(post.body, /Simple Green replacement/);
  assert.match(post.body, /50% degreaser versus 15% active for Simple Green/);
  assert.match(post.body, /Crown Forklift and Plug Power equipment approval/);
  assert.match(post.body, /Heavy-duty performance, HMIS 0-0-0/);
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
    assert.equal((html.match(/<table>/g) || []).length, 3);
    assert.match(html, /src="\/img\/blog\/warehouse-degreasing-trial-hero\.webp"[^>]+width="1440" height="810"/);
    assert.match(html, /src="\/img\/blog\/cases\/cr-hd-walmart-product-field\.webp"[^>]+width="367" height="670"/);
    assert.match(html, /src="\/img\/blog\/diagrams\/warehouse-degreasing-trial\.svg"[^>]+width="1200" height="675"/);
    assert.match(html, /"image":"https:\/\/masest\.co\/img\/blog\/warehouse-degreasing-trial-hero\.webp"/);
    assert.match(html, /href="\/contact\?type=sample&amp;product=CR%20HD#quoteForm"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
