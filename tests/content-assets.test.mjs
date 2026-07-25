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

test("Blog and Newsletter use one shared attach-and-library image picker with reversible archive", () => {
  const blog = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  const newsletter = readFileSync(new URL("../js/admin/newsletter.js", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");

  assert.match(blog, /openImageLibraryPicker/);
  assert.match(newsletter, /openImageLibraryPicker/);
  assert.doesNotMatch(newsletter, /Image URL/);
  assert.match(picker, /Attach image/);
  assert.match(picker, /Browse library/);
  assert.match(picker, /data-shared-image-archive/);
  assert.match(picker, /status:\s*"archived"/);
  assert.doesNotMatch(picker, /data-shared-image-delete/);
  assert.doesNotMatch(picker, /method:\s*"DELETE"/);
  assert.match(picker, /PAGE_SIZE = 4/);
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
  assert.match(source, /data-content-asset-field/);
  assert.match(source, /data-content-asset-alt/);
  assert.match(source, /contentAssetSearch/);
  assert.match(source, /contentAssetStatusFilter/);
  assert.match(source, /refresh_assets/);
  assert.match(source, /close_assets/);
  assert.match(source, /data-content-asset-status-action/);
  assert.match(source, /updateAssetStatus/);
  assert.match(source, /assetCache/);
  assert.match(source, /pairedAssetAltField/);
  assert.match(source, /\/api\/admin\/content-assets/);
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
  const source = readFileSync(new URL("../js/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}\)/);
  assert.match(source, /MAX_UPLOAD_EDGE = 2560/);
  assert.match(source, /scale === 1 && file\.type !== "image\/jpeg"/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /"image\/webp"/);
  assert.match(source, /Preparing upright, web-optimized image/);
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
