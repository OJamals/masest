import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import test from "node:test";

import { verifyCmsImages } from "../tools/build-image-library.mjs";

import { normalizeContentEntry } from "../functions/_lib/content.js";
import { normalizeStructuredPayload } from "../js/content-types.js";
import { PRODUCTS } from "../js/main/catalog-data.js";
import {
  CONTENT_ASSET_PUBLIC_BASE,
  SITE_MEDIA_BASE,
  canonicalPublicImageUrl,
  canonicalContentAssetUrl,
  cmsPublicImageUrl,
  contentAssetPublicUrl,
  managedContentAssetPath,
  rewriteCmsImageReferences,
} from "../js/image-url.js";

const ROOT = new URL("..", import.meta.url).pathname;
const IMAGE_FIELDS = new Set(["hero", "image", "image_after", "og_image"]);
const APPROVED_REPRESENTATIVE_IMAGES = [
  "bid-wmp-review-desk-v1.webp",
  "deposit-analysis-service-v1.webp",
  ...new Set(Object.values(PRODUCTS)
    .map((product) => product.application_image?.split("/").at(-1))
    .filter(Boolean)),
];
const PUBLIC_TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".xml"]);
const PUBLIC_SOURCE_DENY = [
  /^(?:functions|cloudflare|supabase|tools|tests|factory|artifacts|node_modules|dist|tmp)(?:\/|$)/,
  /^(?:audit-[^/]+|audits?|masest\.co-audit)(?:\/|$)/,
  /^(?:\.github|\.vscode|docs\/research)(?:\/|$)/,
  /^data\/(?:company-identity|approved-label-release|public-document-review|update-media-review|update-bundle-review|industry-applications)\.json$/,
  /^data\/(?:catalog|products)\.seed\.json$/,
  /^data\/vertkleen-website-publish-2026-v4\.1\.json$/,
  /^img\/clients\//,
  /^img\/proof\/carib-brewery-table\.webp$/i,
];

function publishedSourceFiles(directory = ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const publicPath = relative(ROOT, path).replaceAll(sep, "/");
    if (PUBLIC_SOURCE_DENY.some((pattern) => pattern.test(publicPath))) return [];
    if (entry.isDirectory()) return publishedSourceFiles(path);
    if (!PUBLIC_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return [];
    if (publicPath === "data/content/site-images.json") return [];
    return [path];
  });
}

function publishedLocalImagePaths() {
  const paths = new Set();
  const pattern = /(?:https?:\/\/(?:www\.)?masest\.co)?(?:(?:\.\.\/)+|\.\/|\/)?img\/[a-z0-9_.@()+%/-]+\.(?:avif|gif|jpe?g|png|svg|webp)/gi;

  for (const path of publishedSourceFiles()) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(pattern)) {
      if (/media\.masest\.co\/site$/i.test(source.slice(Math.max(0, match.index - 40), match.index))) continue;
      let logical = match[0];
      if (/^https?:/i.test(logical)) logical = new URL(logical).pathname;
      logical = canonicalPublicImageUrl(logical);
      if (!/^\/img\//i.test(logical)) continue;
      if (existsSync(join(ROOT, logical.slice(1)))) paths.add(logical);
    }
  }
  return [...paths].sort();
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

test("CMS image manifest exposes managed content images with reusable metadata", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  assert.equal(manifest.count, manifest.assets.length);
  assert.equal(new Set(manifest.assets.map((asset) => asset.storage_path)).size, manifest.assets.length);
  assert.deepEqual(
    manifest.assets.filter((asset) => /\/masest-logo(?:-ink)?\.png$/.test(asset.public_url)).map((asset) => asset.public_url).sort(),
    ["/img/masest-logo-ink.png", "/img/masest-logo.png"],
    "brand source files stay local while published bytes come from R2",
  );
  for (const asset of manifest.assets || []) {
    assert.match(asset.public_url, /^\/img\//);
    assert.equal(asset.storage_path, asset.public_url);
    assert.equal(asset.filename, asset.public_url.split("/").at(-1));
    assert.ok(asset.alt, `${asset.public_url} should have reusable alt text`);
    assert.ok(Number.isInteger(asset.width) && asset.width > 0, `${asset.public_url} should include width`);
    assert.ok(Number.isInteger(asset.height) && asset.height > 0, `${asset.public_url} should include height`);
    assert.ok(Number.isInteger(asset.byte_size) && asset.byte_size > 0, `${asset.public_url} should include byte size`);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.public_url} should include SHA-256`);
    assert.match(asset.mime_type, /^image\/(?:png|svg\+xml|webp)$/);
    assert.equal(asset.status, "available");
    assert.equal(asset.source, "site");
  }
});

test("every published local image source is registered for R2 compilation", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  const managed = new Set(manifest.assets.map((asset) => asset.public_url));
  const missing = publishedLocalImagePaths().filter((path) => !managed.has(path));

  assert.deepEqual(missing, []);
});

test("approved representative scenes use managed-image paths", () => {
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
  const base = "https://media.example.test/site";
  const brewery = "/img/proof/cases/brewery.webp";
  assert.equal(
    cmsPublicImageUrl("../img/proof/cases/brewery.webp?v=7", base),
    `${base}/img/proof/cases/brewery.webp?v=7`,
  );
  assert.equal(cmsPublicImageUrl("/docs/file.pdf", base), "/docs/file.pdf");

  const source = [
    '<img src="img/proof/cases/brewery.webp">',
    '<img src="/img/proof/cases/brewery.webp?v=7">',
    "background:url(../img/proof/cases/brewery.webp)",
    "https://masest.co/img/proof/cases/brewery.webp",
    "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp?legacy=1",
    "/img/products/example.webp",
  ].join("\n");
  const compiled = rewriteCmsImageReferences(source, [brewery], base);
  assert.equal(compiled.match(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 5);
  assert.match(compiled, new RegExp(`${base}/img/proof/cases/brewery\\.webp\\?legacy=1`));
  assert.doesNotMatch(compiled, /supabase\.co\/storage\/v1\/object\/public\/content-assets/);
  assert.match(compiled, /\/img\/products\/example\.webp/);
  assert.doesNotMatch(compiled, /(?:^|[("'=\s])(?:\.\.\/|\/)?img\/proof\/cases\/brewery\.webp/m);
});

test("shared chrome compiles brand logos to R2 while retaining local source files", () => {
  const base = "https://media.example.test/site";
  const chrome = readFileSync(new URL("../js/main/chrome.js", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  const compiled = rewriteCmsImageReferences(
    chrome,
    manifest.assets.map((asset) => asset.public_url),
    base,
  );

  assert.match(compiled, new RegExp(`${base}/img/masest-logo\\.png`));
  assert.match(compiled, new RegExp(`${base}/img/masest-logo-ink\\.png`));
  assert.doesNotMatch(compiled, /src="\/img\/masest-logo(?:-ink)?\.png"/);
});

test("managed content images have one R2 URL owner and preserve legacy object paths", () => {
  const legacy = "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp?v=7#result";

  assert.equal(CONTENT_ASSET_PUBLIC_BASE, "https://media.masest.co");
  assert.equal(SITE_MEDIA_BASE, "https://media.masest.co/site");
  assert.equal(managedContentAssetPath(legacy), "site/img/proof/cases/brewery.webp");
  assert.equal(
    canonicalContentAssetUrl(legacy),
    "https://media.masest.co/site/img/proof/cases/brewery.webp?v=7#result",
  );
  assert.equal(
    canonicalContentAssetUrl("/img/proof/cases/brewery.webp"),
    "https://media.masest.co/site/img/proof/cases/brewery.webp",
  );
  assert.equal(
    canonicalContentAssetUrl("https://untrusted.example/image.webp"),
    "https://untrusted.example/image.webp",
  );
  assert.equal(
    contentAssetPublicUrl("cms/a b/image(1).webp"),
    "https://media.masest.co/cms/a%20b/image(1).webp",
  );
  assert.equal(contentAssetPublicUrl("../private/image.webp"), "");
  assert.equal(contentAssetPublicUrl("cms/image.webp", "javascript:alert(1)"), "");
});

test("image-library builder validates its ledger and verifies public CMS bytes", () => {
  const builder = readFileSync(new URL("../tools/build-image-library.mjs", import.meta.url), "utf8");
  const compiler = readFileSync(new URL("../tools/cf-build.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(pkg.scripts["verify:cms-images"], /build-image-library\.mjs --verify-cms/);
  assert.match(builder, /validateManifest/);
  assert.match(builder, /verifyCmsImages/);
  assert.match(builder, /createHash\("sha256"\)/);
  assert.match(builder, /--verify-cms/);
  assert.doesNotMatch(builder, /SUPABASE_SERVICE_ROLE_KEY|x-upsert|--sync-cms/);
  assert.match(builder, /SITE_MEDIA_BASE/);
  assert.match(compiler, /SITE_MEDIA_BASE/);
  assert.match(compiler, /unresolvedLocalImageReferences/);
  assert.match(compiler, /if \(\/\^\\\/img\\\/\/i\.test\(logical\)\) unresolved\.add\(logical\)/);
  assert.doesNotMatch(compiler, /test\(logical\)\s*&&\s*existsSync/);
  assert.match(compiler, /\^img\\\//, "Pages artifact must not copy image binaries after R2 compilation");
  assert.doesNotMatch(builder + compiler, /MASEST_SUPABASE_URL|storage\/v1\/object\/public\/content-assets\/site/);
});

test("CMS image verification retries bounded remote rate limits", async () => {
  const body = Buffer.from("verified image bytes");
  const delays = [];
  let attempts = 0;
  const asset = {
    storage_path: "/img/test.webp",
    mime_type: "image/webp",
    byte_size: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };

  const result = await verifyCmsImages([asset], "https://media.example.test", {
    concurrency: 1,
    maxAttempts: 3,
    sleep: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      });
    },
  });

  assert.equal(result.count, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [0, 0]);
});

test("local preview serves the production-compiled artifact", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    pkg.scripts.serve,
    "npm run build && python3 -m http.server 4195 --directory dist",
  );
});
