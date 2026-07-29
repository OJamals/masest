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

test("content assets expose exact reverse references and impacted fields", async () => {
  const { withContentAssetReferences } = await import("../functions/api/admin/content-assets.js");
  const assets = withContentAssetReferences([{
    storage_path: "/img/proof/cases/brewery.webp",
    public_url: "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp",
  }, {
    storage_path: "cms/unused.webp",
    public_url: "https://example.supabase.co/storage/v1/object/public/content-assets/cms/unused.webp",
  }], [{
    type: "proof_card",
    slug: "brewery",
    locale: "es",
    status: "published",
    title: "Brewery proof",
    payload: {
      image: "/img/proof/cases/brewery.webp?v=1",
      image_after: "https://example.supabase.co/storage/v1/object/public/content-assets/site/img/proof/cases/brewery.webp",
      body: 'Proof image: <img src="/img/proof/cases/brewery.webp" alt="">',
      not_a_reference: "cms/unused.webp-not-a-reference",
    },
    seo: { og_image: "/img/proof/cases/brewery.webp" },
  }]);

  assert.equal(assets[0].reference_count, 1);
  assert.deepEqual(assets[0].references, [{
    type: "proof_card",
    slug: "brewery",
    locale: "es",
    status: "published",
    title: "Brewery proof",
    fields: ["payload.image", "payload.image_after", "payload.body", "seo.og_image"],
  }]);
  assert.equal(assets[1].reference_count, 0);
  assert.deepEqual(assets[1].references, []);
});

test("asset manager exposes preview-first replacement backed by content revisions", () => {
  const api = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../js/admin/image-library-picker.js", import.meta.url), "utf8");

  assert.match(api, /preview_replace_everywhere/);
  assert.match(api, /apply_replace_everywhere/);
  assert.match(api, /impact_hash/);
  assert.match(api, /repo\.saveEntry/);
  assert.doesNotMatch(api, /"x-upsert":\s*"true"/);
  assert.match(picker, /data-shared-image-replace/);
  assert.match(picker, /Replace everywhere/);
  assert.match(picker, /preview_replace_everywhere/);
  assert.match(picker, /apply_replace_everywhere/);
  assert.match(picker, /data-asset-replacement-diff/);
  assert.match(picker, /Revisions/);
  assert.match(picker, /data-shared-image-impact/);
  assert.match(picker, /content entr/);
});

test("replacement plan previews exact payload and SEO field diffs without mutating entries", async () => {
  const { planContentAssetReplacement } = await import("../functions/api/admin/content-assets.js");
  const oldUrl = "https://example.supabase.co/storage/v1/object/public/content-assets/cms/old.webp";
  const nextUrl = "https://example.supabase.co/storage/v1/object/public/content-assets/cms/new.webp";
  const entry = {
    id: "entry-1",
    type: "page_section",
    slug: "home-hero",
    locale: "en",
    title: "Home hero",
    status: "published",
    version: 7,
    payload: {
      image: oldUrl,
      body: `<figure><img src="${oldUrl}" alt=""></figure>`,
      untouched: "cms/old.webp-not-a-reference",
    },
    seo: { og_image: oldUrl },
  };
  const plan = planContentAssetReplacement({
    source: { storage_path: "cms/old.webp", public_url: oldUrl, source_url: oldUrl },
    target: { storage_path: "cms/new.webp", public_url: nextUrl, source_url: nextUrl },
    entries: [entry],
  });

  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0].fields, [
    { path: "payload.image", before: oldUrl, after: nextUrl },
    {
      path: "payload.body",
      before: `<figure><img src="${oldUrl}" alt=""></figure>`,
      after: `<figure><img src="${nextUrl}" alt=""></figure>`,
    },
    { path: "seo.og_image", before: oldUrl, after: nextUrl },
  ]);
  assert.equal(plan.changes[0].next.payload.image, nextUrl);
  assert.equal(plan.changes[0].next.payload.untouched, "cms/old.webp-not-a-reference");
  assert.equal(entry.payload.image, oldUrl, "preview must not mutate the current entry");
});

test("unsafe in-place replacement is rejected before storage mutation", async () => {
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

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || input?.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body, headers: init.headers });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "GET") {
      return Response.json(url.searchParams.get("select") === "created_by"
        ? [{ created_by: existing.created_by }]
        : [existing]);
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
    assert.equal(response.status, 409);
    assert.deepEqual(result, {
      error: "in_place_replace_unsafe",
      message: "Upload a new asset and use previewed replace everywhere.",
    });
    assert.equal(calls.some(({ url, method }) =>
      url.pathname.includes("/storage/v1/object/") && method === "POST"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replace everywhere rejects stale impact then writes content through revisions", async () => {
  const originalFetch = globalThis.fetch;
  const mutations = [];
  let concurrentChange = false;
  const oldUrl = "https://example.supabase.co/storage/v1/object/public/content-assets/cms/old.webp";
  const nextUrl = "https://example.supabase.co/storage/v1/object/public/content-assets/cms/new.webp";
  const source = {
    storage_path: "cms/old.webp",
    status: "available",
    alt: "Old proof",
    source_url: oldUrl,
  };
  const target = {
    storage_path: "cms/new.webp",
    status: "available",
    alt: "New proof",
    source_url: nextUrl,
  };
  const entry = {
    id: "entry-1",
    type: "page_section",
    slug: "home-hero",
    locale: "es",
    title: "Home hero",
    status: "published",
    version: 7,
    payload: { image: oldUrl },
    seo: { og_image: oldUrl },
    locked_by: "owner-id",
    locked_at: new Date().toISOString(),
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || input?.method || "GET").toUpperCase();
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.pathname === "/rest/v1/content_assets" && method === "GET") {
      const filter = url.searchParams.get("storage_path") || "";
      return Response.json([filter.includes("new.webp") ? target : source]);
    }
    if (url.pathname === "/rest/v1/content_entries" && method === "GET") {
      return Response.json(
        url.searchParams.has("slug") || !url.searchParams.has("locale") ? [entry] : [],
      );
    }
    if (url.pathname === "/rest/v1/content_entries" && ["PATCH", "POST"].includes(method)) {
      const body = JSON.parse(String(init.body || "{}"));
      if (concurrentChange && method === "PATCH") return Response.json([]);
      mutations.push({ table: "content_entries", body });
      return Response.json({ ...body, id: entry.id, version: 8 }, { status: 201 });
    }
    if (url.pathname === "/rest/v1/content_revisions" && method === "POST") {
      mutations.push({ table: "content_revisions", body: JSON.parse(String(init.body || "{}")) });
      return Response.json(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/audit_log" && method === "POST") {
      mutations.push({ table: "audit_log", body: JSON.parse(String(init.body || "{}")) });
      return Response.json(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const request = (body) => contentAssetsRequest({
    request: new Request("https://masest.co/api/admin/content-assets", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env: CONTENT_ASSET_ENV,
  });

  try {
    const previewResponse = await request({
      action: "preview_replace_everywhere",
      source_storage_path: source.storage_path,
      target_storage_path: target.storage_path,
    });
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200);
    assert.equal(preview.preview.change_count, 1);
    assert.equal(preview.preview.field_count, 2);
    assert.match(preview.preview.impact_hash, /^[a-f0-9]{64}$/);

    const staleResponse = await request({
      action: "apply_replace_everywhere",
      source_storage_path: source.storage_path,
      target_storage_path: target.storage_path,
      impact_hash: "stale",
      confirm: "replace_everywhere",
    });
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).error, "asset_impact_changed");
    assert.equal(mutations.length, 0);

    entry.locked_by = "other-editor";
    const lockedResponse = await request({
      action: "apply_replace_everywhere",
      source_storage_path: source.storage_path,
      target_storage_path: target.storage_path,
      impact_hash: preview.preview.impact_hash,
      confirm: "replace_everywhere",
    });
    assert.equal(lockedResponse.status, 409);
    assert.equal((await lockedResponse.json()).error, "content_locked");
    assert.equal(mutations.length, 0);
    entry.locked_by = "owner-id";

    concurrentChange = true;
    const changedResponse = await request({
      action: "apply_replace_everywhere",
      source_storage_path: source.storage_path,
      target_storage_path: target.storage_path,
      impact_hash: preview.preview.impact_hash,
      confirm: "replace_everywhere",
    });
    const changed = await changedResponse.json();
    assert.equal(changedResponse.status, 409);
    assert.equal(changed.error, "asset_impact_changed");
    assert.equal(changed.rolled_back, 0);
    assert.equal(mutations.length, 0);
    concurrentChange = false;

    const applyResponse = await request({
      action: "apply_replace_everywhere",
      source_storage_path: source.storage_path,
      target_storage_path: target.storage_path,
      impact_hash: preview.preview.impact_hash,
      confirm: "replace_everywhere",
    });
    const applied = await applyResponse.json();
    assert.equal(applyResponse.status, 200);
    assert.equal(applied.replaced_entries, 1);
    assert.equal(applied.replaced_fields, 2);
    assert.deepEqual(mutations.map(({ table }) => table), [
      "content_entries",
      "content_revisions",
      "audit_log",
    ]);
    assert.equal(mutations[0].body.payload.image, nextUrl);
    assert.equal(mutations[0].body.seo.og_image, nextUrl);
    assert.equal(mutations[1].body.version, 8);
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
