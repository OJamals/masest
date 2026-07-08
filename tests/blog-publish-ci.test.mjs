import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../tools/publish-blog-ci.mjs", import.meta.url));

function run(entries, out) {
  return execFileSync("node", [SCRIPT], {
    env: { ...process.env, CONTENT_EXPORT_SOURCE: JSON.stringify(entries), CONTENT_EXPORT_OUT_DIR: out },
    encoding: "utf8",
  });
}

test("writes blog.json and patches ONLY the blog manifest entry", () => {
  const out = mkdtempSync(join(tmpdir(), "pbci-"));
  try {
    // A non-blog manifest entry that must survive untouched.
    writeFileSync(join(out, "manifest.json"),
      `${JSON.stringify({ generated_at: "X", files: { "industry-sectors.json": { count: 16, counts: { industry_sectors: 16 }, sha256: "KEEP" } } }, null, 2)}\n`);
    const entries = [{ type: "blog_post", slug: "a", title: "A", status: "published",
      payload: { title: "A", category: "news", date: "2026-01-01", excerpt: "e", body: "b" }, seo: {} }];
    run(entries, out);
    const blog = JSON.parse(readFileSync(join(out, "blog.json"), "utf8"));
    assert.equal(blog.blog_posts.length, 1);
    assert.equal(blog.blog_posts[0].slug, "a");
    const man = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(man.files["industry-sectors.json"].sha256, "KEEP", "other snapshots untouched");
    assert.equal(man.files["blog.json"].count, 1);
    assert.match(man.files["blog.json"].sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("wipe guard: refuses to blank a non-empty blog.json when the source is empty", () => {
  const out = mkdtempSync(join(tmpdir(), "pbci-"));
  try {
    writeFileSync(join(out, "blog.json"), `${JSON.stringify({ blog_posts: [{ slug: "x" }] })}\n`);
    assert.throws(() => run([], out), /Command failed|exit/i);
    // blog.json unchanged
    assert.equal(JSON.parse(readFileSync(join(out, "blog.json"), "utf8")).blog_posts.length, 1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
