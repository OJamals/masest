import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeContentEntry } from "../functions/_lib/content.js";
import { normalizeStructuredPayload } from "../js/content-types.js";
import {
  canonicalPublicImageUrl,
  cmsPublicImageUrl,
  rewriteCmsImageReferences,
} from "../js/image-url.js";

const ROOT = new URL("..", import.meta.url).pathname;
const IMAGE_FIELDS = new Set(["hero", "image", "image_after", "og_image"]);
const APPROVED_REPRESENTATIVE_IMAGES = [
  "alumibrite-aluminum-test-patch-v1.webp",
  "bid-wmp-review-desk-v1.webp",
  "cip-cycle-skid-v1.webp",
  "cr-hd-low-foam-machine-wash-v1.webp",
  "deposit-analysis-service-v1.webp",
  "hvac-descaling-loop-v1.webp",
  "lam3-exterior-surface-trial-v1.webp",
  "neutral-material-test-patch-v1.webp",
  "purgo-controlled-drain-maintenance-v1.webp",
  "sar-application-engineering-v1.webp",
];
const HELD_REPRESENTATIVE_IMAGES = [
  "cr-hd-degreasing-trial-v1.webp",
  "multiwash-facility-floor-v1.webp",
  "torque-contained-fleet-wash-v1.webp",
  "watersafe60-water-program-v1.webp",
];

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
  assert.equal(manifest.count, manifest.assets.length);
  assert.equal(new Set(manifest.assets.map((asset) => asset.storage_path)).size, manifest.assets.length);
  for (const asset of manifest.assets || []) {
    assert.match(asset.public_url, /^\/img\//);
    assert.equal(asset.storage_path, asset.public_url);
    assert.equal(asset.filename, asset.public_url.split("/").at(-1));
    assert.ok(asset.alt, `${asset.public_url} should have reusable alt text`);
    assert.ok(Number.isInteger(asset.width) && asset.width > 0, `${asset.public_url} should include width`);
    assert.ok(Number.isInteger(asset.height) && asset.height > 0, `${asset.public_url} should include height`);
    assert.ok(Number.isInteger(asset.byte_size) && asset.byte_size > 0, `${asset.public_url} should include byte size`);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.public_url} should include SHA-256`);
    assert.match(asset.mime_type, /^image\/(?:png|webp)$/);
    assert.equal(asset.status, "available");
    assert.equal(asset.source, "site");
  }
});

test("approved representative scenes use managed-image paths while held candidates remain internal", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  const representativeAssets = manifest.assets.filter((asset) =>
    asset.storage_path.startsWith("/img/representative/applications/")
  );

  assert.deepEqual(
    representativeAssets.map((asset) => asset.filename).sort(),
    [...APPROVED_REPRESENTATIVE_IMAGES].sort(),
  );
  for (const asset of representativeAssets) {
    assert.match(asset.alt, /^Representative /);
    assert.equal(asset.category, "representative");
  }
  for (const filename of HELD_REPRESENTATIVE_IMAGES) {
    assert.equal(
      manifest.assets.some((asset) => asset.filename === filename),
      false,
      `${filename} must remain unpublished`,
    );
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

test("shared chrome does not prefix compiled CMS logo URLs with a page-relative root", () => {
  const base = "https://example.supabase.co/storage/v1/object/public/content-assets/site";
  const chrome = readFileSync(new URL("../js/main/chrome.js", import.meta.url), "utf8");
  const compiled = rewriteCmsImageReferences(chrome, [
    "/img/masest-logo.png",
    "/img/masest-logo-ink.png",
  ], base);

  assert.doesNotMatch(compiled, /\$\{root\}https:\/\/example\.supabase\.co/);
  assert.match(compiled, new RegExp(`src="${base}/img/masest-logo\\.png"`));
  assert.match(compiled, new RegExp(`src="${base}/img/masest-logo-ink\\.png"`));
});

test("image-library builder validates its ledger and verifies public CMS bytes", () => {
  const builder = readFileSync(new URL("../tools/build-image-library.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(pkg.scripts["verify:cms-images"], /build-image-library\.mjs --verify-cms/);
  assert.match(builder, /validateManifest/);
  assert.match(builder, /verifyCmsImages/);
  assert.match(builder, /createHash\("sha256"\)/);
  assert.match(builder, /--verify-cms/);
  assert.doesNotMatch(builder, /SUPABASE_SERVICE_ROLE_KEY|x-upsert|--sync-cms/);
});
