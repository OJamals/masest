import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

import { normalizeContentEntry } from "../functions/_lib/content.js";
import { normalizeStructuredPayload } from "../js/content-types.js";

const ROOT = new URL("..", import.meta.url).pathname;
const IMAGE_EXTENSIONS = new Set([".png", ".webp"]);

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
    assert.equal(asset.status, "available");
    assert.equal(asset.source, "site");
  }
});

test("site and CMS assets merge into one searchable, de-duplicated library", async () => {
  const { mergeSiteImageAssets } = await import("../js/admin/site-image-library.js");
  const merged = mergeSiteImageAssets({
    cmsAssets: [{
      storage_path: "img/proof/cases/brewery.webp",
      public_url: "img/proof/cases/brewery.webp",
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

  assert.deepEqual(merged.map((asset) => asset.public_url), ["/img/proof/cases/brewery.webp"]);
  assert.equal(merged[0].alt, "CMS-authored brewery proof");
  assert.equal(merged[0].source, "cms");
});
