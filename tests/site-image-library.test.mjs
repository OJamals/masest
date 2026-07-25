import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

import { normalizeContentEntry } from "../functions/_lib/content.js";
import { normalizeStructuredPayload } from "../js/content-types.js";
import {
  canonicalPublicImageUrl,
  cmsPublicImageUrl,
  rewriteCmsImageReferences,
} from "../js/image-url.js";

const ROOT = new URL("..", import.meta.url).pathname;
const IMAGE_EXTENSIONS = new Set([".png", ".webp"]);
const IMAGE_FIELDS = new Set(["hero", "image", "image_after", "og_image"]);

function imageFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) imageFiles(path, files);
    else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(`/${relative(ROOT, path)}`);
    }
  }
  return files;
}

function contentImagePaths(value, field = "", paths = []) {
  if (Array.isArray(value)) {
    for (const item of value) contentImagePaths(item, field, paths);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) contentImagePaths(item, key, paths);
  } else if (IMAGE_FIELDS.has(field) && typeof value === "string" && value.trim()) {
    const pathname = new URL(canonicalPublicImageUrl(value), "https://masest.co").pathname;
    const cmsSitePrefix = "/storage/v1/object/public/content-assets/site";
    paths.push(pathname.startsWith(`${cmsSitePrefix}/img/`)
      ? pathname.slice(cmsSitePrefix.length)
      : pathname);
  }
  return paths;
}

test("CMS image fields store root-absolute public paths", () => {
  assert.equal(
    normalizeStructuredPayload("page_section", { image: "img/proof/cases/brewery.webp" }).image,
    "/img/proof/cases/brewery.webp",
  );
  assert.equal(
    normalizeStructuredPayload("proof_card", { image_after: "../img/proof/cases/hood-after.webp" }).image_after,
    "/img/proof/cases/hood-after.webp",
  );
  assert.equal(
    normalizeStructuredPayload("blog_post", { hero: "./img/blog/hmis-000-explained.webp" }).hero,
    "/img/blog/hmis-000-explained.webp",
  );
  assert.equal(
    normalizeStructuredPayload("page_meta", { og_image: "img/og-card.png" }).og_image,
    "/img/og-card.png",
  );
});

test("content API canonicalizes image paths even when callers bypass the admin form", () => {
  const entry = normalizeContentEntry({
    type: "proof_card",
    title: "Proof",
    payload: {
      image: "img/proof/cases/hood-before.webp",
      image_after: "../img/proof/cases/hood-after.webp",
    },
    seo: { og_image: "./img/og-card.png" },
  });

  assert.equal(entry.payload.image, "/img/proof/cases/hood-before.webp");
  assert.equal(entry.payload.image_after, "/img/proof/cases/hood-after.webp");
  assert.equal(entry.seo.og_image, "/img/og-card.png");
});

test("site image manifest exposes every public image with reusable metadata", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  const expected = imageFiles(join(ROOT, "img")).sort();
  const actual = (manifest.assets || []).map((asset) => asset.public_url).sort();

  assert.deepEqual(actual, expected);
  for (const asset of manifest.assets || []) {
    assert.match(asset.public_url, /^\/img\//);
    assert.ok(asset.alt, `${asset.public_url} should have reusable alt text`);
    assert.ok(asset.width > 0 && asset.height > 0, `${asset.public_url} should include dimensions`);
    const bytes = readFileSync(join(ROOT, asset.public_url.slice(1)));
    assert.equal(asset.byte_size, bytes.byteLength, `${asset.public_url} should include exact byte size`);
    assert.equal(
      asset.sha256,
      createHash("sha256").update(bytes).digest("hex"),
      `${asset.public_url} should include exact SHA-256`,
    );
    assert.equal(asset.status, "available");
    assert.equal(asset.source, "site");
  }
});

test("published CMS snapshots reference images in the shared site library", () => {
  const contentDir = join(ROOT, "data/content");
  const manifest = JSON.parse(readFileSync(join(contentDir, "site-images.json"), "utf8"));
  const knownImages = new Set((manifest.assets || []).map((asset) => asset.public_url));
  const missing = [];

  for (const filename of readdirSync(contentDir).filter((name) => name.endsWith(".json") && name !== "site-images.json")) {
    const content = JSON.parse(readFileSync(join(contentDir, filename), "utf8"));
    for (const imagePath of contentImagePaths(content)) {
      if (!knownImages.has(imagePath)) missing.push(`${filename}: ${imagePath}`);
    }
  }

  assert.deepEqual(missing, []);
});

test("site and CMS assets merge into one searchable, de-duplicated library", async () => {
  const { formatAssetBytes, mergeSiteImageAssets } = await import("../js/admin/site-image-library.js");
  const merged = mergeSiteImageAssets({
    cmsAssets: [{
      storage_path: "/img/proof/cases/brewery.webp",
      public_url: "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp",
      alt: "CMS-authored brewery proof",
      status: "available",
    }],
    siteAssets: [{
      storage_path: "/img/proof/cases/brewery.webp",
      public_url: "/img/proof/cases/brewery.webp",
      alt: "Generated brewery proof",
      status: "available",
      source: "site",
    }, {
      storage_path: "/img/story/scale.webp",
      public_url: "/img/story/scale.webp",
      alt: "Scale buildup",
      status: "available",
      source: "site",
    }],
    q: "brewery",
  });

  assert.deepEqual(merged.map((asset) => asset.public_url), [
    "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp",
  ]);
  assert.equal(merged[0].alt, "CMS-authored brewery proof");
  assert.equal(merged[0].source, "cms");
  assert.equal(formatAssetBytes(1024), "1 KB");
  assert.equal(formatAssetBytes(239_674), "234.1 KB");
  assert.equal(formatAssetBytes(null), "");
});

test("known site image references compile to stable CMS storage URLs", () => {
  const base = "https://example.supabase.co/storage/v1/object/public/content-assets/site";
  const brewery = "/img/proof/cases/brewery.webp";
  assert.equal(
    cmsPublicImageUrl("../img/proof/cases/brewery.webp?v=7", base),
    `${base}/img/proof/cases/brewery.webp?v=7`,
  );
  assert.equal(cmsPublicImageUrl("/docs/file.pdf", base), "/docs/file.pdf");

  const source = [
    '<img src="/img/proof/cases/brewery.webp?v=7">',
    "background:url(../img/proof/cases/brewery.webp)",
    "https://masest.co/img/proof/cases/brewery.webp",
    "/img/products/example.webp",
  ].join("\n");
  const compiled = rewriteCmsImageReferences(source, [brewery], base);
  assert.equal(compiled.match(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 3);
  assert.match(compiled, /\/img\/products\/example\.webp/);
  assert.doesNotMatch(compiled, /(?:^|[("'=\s])(?:\.\.\/|\/)img\/proof\/cases\/brewery\.webp/m);
});

test("image-library builder can idempotently sync site assets and live CMS references", () => {
  const builder = readFileSync(new URL("../tools/build-image-library.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(pkg.scripts["sync:cms-images"], /build-image-library\.mjs --sync-cms/);
  assert.match(builder, /--sync-cms/);
  assert.match(builder, /site\$\{asset\.storage_path\}/);
  assert.match(builder, /x-upsert/);
  assert.match(builder, /content_entries/);
  assert.match(builder, /products/);
  assert.match(builder, /rewriteCmsImageReferences/);
});
