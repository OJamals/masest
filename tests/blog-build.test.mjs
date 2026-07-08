import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_TYPE_DEFINITIONS, snapshotGroups, structuredPayloadKeys } from "../js/content-types.js";
import { snapshotPayloads } from "../tools/build-content.mjs";
import { buildBlog } from "../tools/build-blog.mjs";

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
      assert.match(html, new RegExp(`<h1[^>]*>${p.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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
