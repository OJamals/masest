import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onRequest as productImageRequest } from "../functions/api/admin/product-image.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("product media has one storage owner: the Cloudflare R2 binding", () => {
  const route = readFileSync(new URL("../functions/api/admin/product-image.js", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../supabase/schema-images.sql", import.meta.url), "utf8");

  assert.match(route, /env\.CONTENT_IMAGES\.put/);
  assert.doesNotMatch(route, /storage\/v1\/object|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(schema, /storage\.buckets|product-images/);
});

function productImageEnv(binding) {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    ADMIN_EMAILS: "owner@example.com",
    CONTENT_ASSET_PUBLIC_BASE: "https://media.masest.co",
    CONTENT_IMAGES: binding,
  };
}

function installSupabaseBoundary({ product = null } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || input?.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.pathname === "/rest/v1/products" && method === "GET") {
      return Response.json(product ? [product] : []);
    }
    if (url.pathname === "/rest/v1/products" && method === "PATCH") {
      return Response.json([]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return calls;
}

test("admin product upload stores public media through the Cloudflare R2 binding", async () => {
  const supabaseCalls = installSupabaseBoundary();
  const puts = [];
  const binding = {
    async put(key, value, options) {
      puts.push({ key, value: new Uint8Array(value), options });
      return { key };
    },
    async delete() {},
  };
  const form = new FormData();
  form.append("sku", "HCR");
  form.append("slot", "primary");
  form.append("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" }), "test.webp");

  const response = await productImageRequest({
    request: new Request("https://masest.co/api/admin/product-image", {
      method: "POST",
      headers: { authorization: "Bearer owner-token" },
      body: form,
    }),
    env: productImageEnv(binding),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(body.path, /^products\/hcr\/[0-9a-f-]+\.webp$/);
  assert.equal(body.url, `https://media.masest.co/${body.path}`);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, body.path);
  assert.deepEqual([...puts[0].value], [1, 2, 3, 4]);
  assert.deepEqual(puts[0].options.httpMetadata, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  });
  assert.equal(supabaseCalls.some(({ url }) => url.pathname.includes("/storage/v1/object/")), false);
  const update = supabaseCalls.find(({ url, method }) => url.pathname === "/rest/v1/products" && method === "PATCH");
  assert.match(String(update?.body), /https:\/\/media\.masest\.co\/products\/hcr\//);
});

test("removing an R2-owned product image deletes only its managed object", async () => {
  const url = "https://media.masest.co/products/hcr/photo.webp";
  const supabaseCalls = installSupabaseBoundary({
    product: { image_url: url, gallery: [url, "https://media.masest.co/site/img/products/shared.webp"] },
  });
  const deletes = [];
  const binding = {
    async put() {},
    async delete(key) { deletes.push(key); },
  };

  const response = await productImageRequest({
    request: new Request("https://masest.co/api/admin/product-image", {
      method: "DELETE",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sku: "hcr", url }),
    }),
    env: productImageEnv(binding),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(deletes, ["products/hcr/photo.webp"]);
  assert.equal(supabaseCalls.some(({ url: calledUrl }) => calledUrl.pathname.includes("/storage/v1/object/")), false);
  const update = supabaseCalls.find(({ url: calledUrl, method }) => calledUrl.pathname === "/rest/v1/products" && method === "PATCH");
  assert.deepEqual(JSON.parse(String(update.body)), {
    gallery: ["https://media.masest.co/site/img/products/shared.webp"],
    image_url: null,
  });
});

test("legacy Supabase metadata unlinks through its canonical R2 URL without deleting shared site media", async () => {
  const legacyUrl = "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/site/img/products/hcr.webp";
  const r2Url = "https://media.masest.co/site/img/products/hcr.webp";
  const supabaseCalls = installSupabaseBoundary({
    product: { image_url: legacyUrl, gallery: [legacyUrl] },
  });
  const deletes = [];

  const response = await productImageRequest({
    request: new Request("https://masest.co/api/admin/product-image", {
      method: "DELETE",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sku: "hcr", url: r2Url }),
    }),
    env: productImageEnv({
      async put() {},
      async delete(key) { deletes.push(key); },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(deletes, []);
  const update = supabaseCalls.find(({ url, method }) => url.pathname === "/rest/v1/products" && method === "PATCH");
  assert.deepEqual(JSON.parse(String(update.body)), { gallery: [], image_url: null });
});

test("adding a gallery image stores its canonical R2 URL", async () => {
  const legacyUrl = "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/site/img/products/hcr-detail.webp";
  const r2Url = "https://media.masest.co/site/img/products/hcr-detail.webp";
  const supabaseCalls = installSupabaseBoundary({
    product: { image_url: "https://media.masest.co/site/img/products/hcr.webp", gallery: [] },
  });

  const response = await productImageRequest({
    request: new Request("https://masest.co/api/admin/product-image", {
      method: "PATCH",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sku: "hcr", action: "add_gallery", url: legacyUrl }),
    }),
    env: productImageEnv({ async put() {}, async delete() {} }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, gallery: [r2Url] });
  const update = supabaseCalls.find(({ url, method }) => url.pathname === "/rest/v1/products" && method === "PATCH");
  assert.deepEqual(JSON.parse(String(update.body)), { gallery: [r2Url] });
});

test("product uploads reject unsafe paths and unapproved image types before R2", async () => {
  installSupabaseBoundary();
  let putCount = 0;
  const binding = {
    async put() { putCount += 1; },
    async delete() {},
  };
  const requestFor = (sku, type) => {
    const form = new FormData();
    form.append("sku", sku);
    form.append("file", new Blob(["not-an-image"], { type }), "upload.bin");
    return new Request("https://masest.co/api/admin/product-image", {
      method: "POST",
      headers: { authorization: "Bearer owner-token" },
      body: form,
    });
  };

  const unsafePath = await productImageRequest({
    request: requestFor("../hcr", "image/webp"),
    env: productImageEnv(binding),
  });
  const unsafeType = await productImageRequest({
    request: requestFor("hcr", "image/svg+xml"),
    env: productImageEnv(binding),
  });

  assert.equal(unsafePath.status, 400);
  assert.equal((await unsafePath.json()).error, "invalid_sku");
  assert.equal(unsafeType.status, 400);
  assert.equal((await unsafeType.json()).error, "not_an_image");
  assert.equal(putCount, 0);
});
