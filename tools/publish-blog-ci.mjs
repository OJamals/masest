#!/usr/bin/env node
// Blog-only content publish for CI. Pulls published blog_post entries from
// Supabase, writes data/content/blog.json and patches ONLY that file's manifest
// entry — every other content snapshot is left untouched. This is deliberate:
// blog posts are authored in the CMS (Supabase = source of truth), but other
// content (e.g. industry sectors) is generated from git-side tooling, so a
// blanket publish-content in CI would wrongly revert those to Supabase.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEntries, snapshotPayloads } from "./build-content.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = process.env.CONTENT_EXPORT_OUT_DIR || join(ROOT, "data/content");
const PROTECTED_COMPARISON_SLUGS = [
  "vertkleen-hcr-vs-clr",
  "hcr-vs-rydlyme",
  "cr-hd-vs-simple-green",
  "lam3-vs-wet-forget",
  "beer-line-cleaner-cost-comparison",
];

async function main() {
  const entries = await loadEntries();
  if (!entries) {
    console.error("publish-blog-ci: no content source. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exitCode = 1;
    return;
  }
  const payload = snapshotPayloads(entries)["blog.json"];
  const posts = payload.blog_posts || [];
  const blogPath = join(OUT, "blog.json");

  // Publishing must not silently remove protected SEO posts. This catches both
  // an empty source and a valid-looking partial CMS response.
  if (existsSync(blogPath)) {
    const prev = JSON.parse(readFileSync(blogPath, "utf8")).blog_posts || [];
    if (prev.length) {
      if (!posts.length) {
        console.error("publish-blog-ci: refusing to wipe blog.json to 0 posts (source returned none).");
        process.exitCode = 1;
        return;
      }
      const previousSlugs = new Set(prev.map((post) => post.slug));
      const nextSlugs = new Set(posts.map((post) => post.slug));
      const missingProtected = PROTECTED_COMPARISON_SLUGS.filter(
        (slug) => previousSlugs.has(slug) && !nextSlugs.has(slug),
      );
      if (missingProtected.length) {
        console.error(`publish-blog-ci: refusing to remove protected comparison posts: ${missingProtected.join(", ")}.`);
        process.exitCode = 1;
        return;
      }
    }
  }

  const text = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(blogPath, text);

  // Patch ONLY the blog.json entry in the manifest; leave all others intact.
  const manPath = join(OUT, "manifest.json");
  const manifest = existsSync(manPath) ? JSON.parse(readFileSync(manPath, "utf8")) : { files: {} };
  manifest.files = manifest.files || {};
  manifest.files["blog.json"] = {
    count: posts.length,
    counts: { blog_posts: posts.length },
    sha256: createHash("sha256").update(text).digest("hex"),
  };
  writeFileSync(manPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`publish-blog-ci: wrote blog.json (${posts.length} posts) + patched manifest entry.`);
}

main().catch((error) => {
  console.error(`publish-blog-ci failed: ${error?.message || error}`);
  process.exitCode = 1;
});
