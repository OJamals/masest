import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as contentAssetsRequest } from "../functions/api/admin/content-assets.js";

const CONTENT_ASSET_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ADMIN_EMAILS: "owner@example.com",
};

test("content schema stores asset metadata, usage, and focal points", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /content_assets/);
  assert.match(sql, /alt\s+text\s+not null/);
  assert.match(sql, /byte_size\s+bigint/);
  assert.match(sql, /sha256\s+text/);
  assert.match(sql, /focal_point\s+jsonb/);
  assert.match(sql, /usage\s+jsonb/);
  assert.match(sql, /asset_status/);
});

test("asset endpoint is staff gated and content asset permission gated", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /staffCan\(role, "content\.assets"\)/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /request\.method === "PUT"/);
});

test("logical site aliases resolve to managed CMS objects without trusting external URLs", async () => {
  const {
    assetPublicUrl,
    managedStoragePath,
    siteStoragePath,
  } = await import("../functions/api/admin/content-assets.js");
  const env = CONTENT_ASSET_ENV;
  const logical = "/img/proof/cases/brewery.webp";
  const managedUrl = "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp";
  const asset = { storage_path: logical, source_url: managedUrl };

  assert.equal(siteStoragePath(logical), "site/img/proof/cases/brewery.webp");
  assert.equal(assetPublicUrl(env, asset), managedUrl);
  assert.equal(managedStoragePath(env, asset), "site/img/proof/cases/brewery.webp");
  assert.equal(managedStoragePath(env, {
    storage_path: logical,
    source_url: "https://untrusted.example/image.webp",
  }), "");
});

test("asset manager exposes replace-everywhere control backed by optimized in-place storage", () => {
  const api = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");

  assert.match(api, /replace_storage_path/);
  assert.match(api, /"x-upsert":\s*"true"/);
  assert.match(api, /content_asset\.replaced/);
  assert.match(picker, /data-shared-image-replace/);
  assert.match(picker, /Replace everywhere/);
  assert.match(picker, /method:\s*"PUT"/);
});

test("replace everywhere overwrites the stable CMS object and keeps the logical site alias", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const logicalPath = "/img/proof/replacement-test.webp";
  const publicUrl = `https://example.supabase.co/storage/v1/object/public/content-assets/site${logicalPath}`;
  const existing = {
    storage_path: logicalPath,
    status: "available",
    alt: "Existing proof",
    mime_type: "image/webp",
    byte_size: 10,
    sha256: "a".repeat(64),
    width: 100,
    height: 100,
    focal_point: {},
    usage: ["site:proof"],
    credit: null,
    source_url: publicUrl,
    created_by: "original-owner",
  };
  const optimized = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || input?.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body, headers: init.headers });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.hostname === "api.tinify.com" && url.pathname === "/shrink") {
      return new Response(null, {
        status: 201,
        headers: { location: "https://api.tinify.com/output/replacement" },
      });
    }
    if (url.hostname === "api.tinify.com" && url.pathname === "/output/replacement") {
      return new Response(optimized, { status: 200 });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "GET") {
      return Response.json(url.searchParams.get("select") === "created_by"
        ? [{ created_by: existing.created_by }]
        : [existing]);
    }
    if (url.pathname === "/storage/v1/object/content-assets/site/img/proof/replacement-test.webp"
      && method === "POST") {
      return Response.json({ Key: "site/img/proof/replacement-test.webp" }, { status: 200 });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "POST") {
      const row = JSON.parse(String(init.body));
      return Response.json({ ...existing, ...row }, { status: 201 });
    }
    if (url.pathname === "/rest/v1/audit_log" && method === "POST") {
      return Response.json(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const form = new FormData();
  form.append("replace_storage_path", logicalPath);
  form.append("alt", "Updated proof");
  form.append("width", "1200");
  form.append("height", "800");
  form.append("file", new Blob([new Uint8Array(32)], { type: "image/webp" }), "replacement.webp");

  try {
    const response = await contentAssetsRequest({
      request: new Request("https://masest.co/api/admin/content-assets", {
        method: "PUT",
        headers: { authorization: "Bearer owner-token" },
        body: form,
      }),
      env: { ...CONTENT_ASSET_ENV, TINIFY_API_KEY: "tinify-key" },
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.asset.storage_path, logicalPath);
    assert.equal(result.asset.public_url, publicUrl);
    assert.equal(result.asset.alt, "Updated proof");
    const upload = calls.find(({ url, method }) => url.pathname.includes("/storage/v1/object/") && method === "POST");
    assert.equal(upload?.headers?.["x-upsert"], "true");
    const audit = calls.find(({ url, method }) => url.pathname === "/rest/v1/audit_log" && method === "POST");
    assert.match(String(audit?.body), /content_asset\.replaced/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("asset endpoint accepts multipart upload into CMS asset storage", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /request\.formData\(\)/);
  assert.match(source, /CONTENT_ASSET_BUCKET/);
  assert.match(source, /CONTENT_ASSET_MAX_BYTES/);
  assert.match(source, /storage\/v1\/object/);
  assert.match(source, /file_required/);
  assert.match(source, /unsupported_image_type/);
  assert.match(source, /asset_too_large/);
  assert.match(source, /storage_not_configured/);
  assert.match(source, /saveAsset/);
});

test("uploaded content images are optimized with TinyPNG before storage", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");

  assert.match(source, /TINIFY_API_KEY/);
  assert.match(source, /https:\/\/api\.tinify\.com\/shrink/);
  assert.match(source, /optimized_image_required/);
  assert.match(source, /optimizeWithTinyPng/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /findAssetBySha256/);
  assert.match(source, /deduplicated:\s*true/);
  assert.match(source, /byte_size:/);
  assert.match(source, /sha256:/);
  assert.match(repository, /async findAssetBySha256\(/);
});

test("permanent deletion requires confirmation and an archived asset before deleting storage", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let assetStatus = "available";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || input?.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "GET") {
      return Response.json([{
        storage_path: "cms/test.webp",
        status: assetStatus,
        alt: "Test image",
        byte_size: 1200,
        source_url: "https://example.supabase.co/storage/v1/object/public/content-assets/cms/test.webp",
      }]);
    }
    if (url.pathname === "/storage/v1/object/content-assets/cms/test.webp" && method === "DELETE") {
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rest/v1/audit_log" && method === "POST") {
      return Response.json(null, { status: 201 });
    }
    throw new Error(`Unexpected Supabase request: ${method} ${url.pathname}`);
  };

  const request = (query) => contentAssetsRequest({
    request: new Request(`https://masest.co/api/admin/content-assets?storage_path=cms%2Ftest.webp${query}`, {
      method: "DELETE",
      headers: { authorization: "Bearer owner-token" },
    }),
    env: CONTENT_ASSET_ENV,
  });
  const destructiveCalls = () => calls.filter(({ method }) => method === "DELETE");

  try {
    const unconfirmed = await request("");
    assert.equal(unconfirmed.status, 409);
    assert.deepEqual(await unconfirmed.json(), { error: "permanent_delete_confirmation_required" });
    assert.equal(destructiveCalls().length, 0);

    const available = await request("&permanent=true");
    assert.equal(available.status, 409);
    assert.deepEqual(await available.json(), { error: "asset_must_be_archived" });
    assert.equal(destructiveCalls().length, 0);

    assetStatus = "archived";
    const archived = await request("&permanent=true");
    assert.equal(archived.status, 200);
    assert.equal(destructiveCalls().length, 2);
    const audit = calls.find(({ url, method }) => url.pathname === "/rest/v1/audit_log" && method === "POST");
    assert.match(String(audit?.body), /content_asset\.deleted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Blog, Newsletter, Products, and Content use one preview-first image viewer", () => {
  const blog = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  const newsletter = readFileSync(new URL("../js/admin/newsletter.js", import.meta.url), "utf8");
  const products = readFileSync(new URL("../js/admin/products.js", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");

  assert.match(blog, /openImageLibraryPicker/);
  assert.match(newsletter, /openImageLibraryPicker/);
  assert.match(products, /openImageLibraryPicker/);
  assert.doesNotMatch(newsletter, /Image URL/);
  assert.match(picker, /Attach image/);
  assert.match(picker, /Browse library/);
  assert.match(picker, /data-shared-image-preview/);
  assert.match(picker, /data-shared-image-option/);
  assert.match(picker, /data-shared-image-confirm/);
  assert.match(picker, /data-shared-image-state/);
  assert.match(picker, /"archived"/);
  assert.doesNotMatch(picker, /method:\s*"DELETE"/);
  assert.doesNotMatch(picker, /PAGE_SIZE|data-shared-image-page/);
  assert.match(picker, /loadSiteImageAssets/);
  assert.match(picker, /mergeSiteImageAssets/);
  assert.match(picker, /data-shared-image-search/);
  assert.match(picker, /CMS uploads first/);
});

test("asset repository rejects unsafe references and exposes the complete current catalog", () => {
  const source = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /unsafeAssetReference/);
  assert.match(source, /storage_path_invalid/);
  assert.match(source, /javascript\|data\|vbscript/);
  assert.match(source, /\.limit\(1000\)/);
});

test("saveAsset preserves the original creator across updates (archive/restore re-send the row)", () => {
  const source = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /\.from\("content_assets"\)\.select\("created_by"\)\.eq\("storage_path", storagePath\)/);
  assert.match(source, /created_by: existing\?\.created_by \|\| userId \|\| null/);
});

test("content editor has an asset picker contract", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8") + readFileSync(new URL("../js/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetPicker/);
  assert.match(source, /open_asset_viewer/);
  assert.match(source, /Open Asset Viewer/);
  assert.match(source, /openImageLibraryPicker/);
  assert.match(source, /autoOpenLibrary:\s*true/);
  assert.match(source, /manage:\s*true/);
  assert.match(source, /close_assets/);
  assert.match(source, /pairedAssetAltField/);
  assert.match(source, /\/api\/admin\/content-assets/);
  assert.doesNotMatch(source, /contentAssetRows|contentAssetPager/);
});

test("asset viewer contains the complete library inside a bounded 3-4 column window", () => {
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/components.css", import.meta.url), "utf8");

  assert.match(picker, /assets\.map\(\(asset\) => assetOption/);
  assert.match(css, /\.shared-image-library-layout\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.shared-image-library-grid\s*\{[^}]*repeat\(4,/);
  assert.match(css, /\.shared-image-library-grid\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*repeat\(3,/);
});

test("content editor exposes native asset upload controls", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8") + readFileSync(new URL("../js/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetUpload/);
  assert.match(source, /contentAssetFolder/);
  assert.match(source, /contentAssetFile/);
  assert.match(source, /contentAssetAlt/);
  assert.match(source, /data-content-action="upload_asset"/);
  assert.match(source, /new FormData\(\)/);
});

test("content uploads bake EXIF orientation and cap source dimensions before storage", () => {
  const controls = readFileSync(new URL("../js/admin/content-assets.js", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("../js/admin/site-image-library.js", import.meta.url), "utf8");
  assert.match(source, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}\)/);
  assert.match(source, /MAX_UPLOAD_EDGE = 2560/);
  assert.match(source, /scale === 1 && file\.type !== "image\/jpeg"/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /"image\/webp"/);
  assert.match(controls, /prepareImageUpload\(file\)/);
  assert.match(picker, /prepareImageUpload\(selectedFile\)/);
  assert.match(controls + picker, /Preparing upright, web-optimized image/);
});

test("content editor registers existing asset paths without a file upload", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8") + readFileSync(new URL("../js/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetRegister/);
  assert.match(source, /contentAssetPath/);
  assert.match(source, /contentAssetPathAlt/);
  assert.match(source, /contentAssetCredit/);
  assert.match(source, /data-content-action="register_asset"/);
  assert.match(source, /registerAsset/);
  assert.match(source, /usage:\s*\[assetTargetField/);
});

test("admin API helper preserves FormData bodies for uploads", () => {
  const source = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
  assert.match(source, /body instanceof FormData/);
  assert.match(source, /JSON\.stringify\(body\)/);
});
