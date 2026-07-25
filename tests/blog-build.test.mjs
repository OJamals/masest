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
