import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTENT_TYPE_DEFINITIONS, snapshotGroups, structuredPayloadKeys } from "../js/content-types.js";
import { snapshotPayloads } from "../tools/build-content.mjs";

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
