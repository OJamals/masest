import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  listSupabaseObjects,
  migrationEnvironments,
  migrateContentAssets,
  sourceObjectUrl,
  verifyMigratedContentAssets,
} from "../tools/migrate-content-assets-to-r2.mjs";

test("Supabase content-assets inventory walks folders deterministically", async () => {
  const requests = [];
  const pages = new Map([
    ["|0", [{ name: "site", id: null, metadata: null }]],
    ["site|0", [
      { name: "hero.webp", id: "one", metadata: { size: 4, mimetype: "image/webp" } },
      { name: "proof", id: null, metadata: null },
    ]],
    ["site/proof|0", [{ name: "after.png", id: "two", metadata: { size: 3, mimetype: "image/png" } }]],
  ]);
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body, authorization: init.headers.Authorization });
    return Response.json(pages.get(`${body.prefix}|${body.offset}`) || []);
  };

  const objects = await listSupabaseObjects({
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "secret",
    bucket: "content-assets",
    fetchImpl,
  });

  assert.deepEqual(objects.map(({ name }) => name), ["site/hero.webp", "site/proof/after.png"]);
  assert.deepEqual(objects.map(({ byteSize }) => byteSize), [4, 3]);
  assert.equal(requests[0].url, "https://example.supabase.co/storage/v1/object/list/content-assets");
  assert.equal(requests[0].authorization, "Bearer secret");
  assert.deepEqual(requests.map(({ body }) => body.prefix), ["", "site", "site/proof"]);
});

test("migration preserves keys and verifies target bytes, hashes, MIME, and cache policy", async () => {
  const bodies = new Map([
    ["site/hero.webp", Buffer.from("hero")],
    ["site/proof/after.png", Buffer.from("after")],
  ]);
  const objects = [...bodies].map(([name, body]) => ({
    name,
    byteSize: body.byteLength,
    mimeType: name.endsWith(".png") ? "image/png" : "image/webp",
  }));
  const uploads = [];
  const sourceFetch = async (url) => {
    const key = decodeURIComponent(new URL(url).pathname.split("/content-assets/")[1]);
    const body = bodies.get(key);
    return new Response(body, { headers: { "Content-Type": objects.find((item) => item.name === key).mimeType } });
  };
  const migrated = await migrateContentAssets(objects, {
    sourceBase: "https://example.supabase.co/storage/v1/object/public/content-assets",
    fetchImpl: sourceFetch,
    upload: async (asset) => uploads.push(asset),
    concurrency: 2,
  });

  assert.deepEqual(uploads.map(({ key }) => key).sort(), [...bodies.keys()].sort());
  for (const asset of migrated) {
    assert.equal(asset.sha256, createHash("sha256").update(bodies.get(asset.key)).digest("hex"));
    assert.equal(asset.cacheControl, "public, max-age=31536000, immutable");
  }

  const verified = await verifyMigratedContentAssets(migrated, {
    targetBase: "https://media.masest.co",
    fetchImpl: async (url) => {
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      const asset = migrated.find((item) => item.key === key);
      return new Response(bodies.get(key), {
        headers: {
          "Content-Type": asset.mimeType,
          "Cache-Control": asset.cacheControl,
        },
      });
    },
    concurrency: 2,
  });
  assert.deepEqual(verified, {
    count: 2,
    bytes: Buffer.byteLength("heroafter"),
    targetBase: "https://media.masest.co",
  });
});

test("migration source URLs encode each object-key segment", () => {
  assert.equal(
    sourceObjectUrl("https://example.supabase.co/storage/v1/object/public/content-assets", "site/a b/image(1).webp"),
    "https://example.supabase.co/storage/v1/object/public/content-assets/site/a%20b/image(1).webp",
  );
});

test("local source credentials never override Wrangler authentication", () => {
  const local = {
    SUPABASE_SERVICE_ROLE_KEY: "local-source-key",
    CLOUDFLARE_API_TOKEN: "pages-only-token",
  };
  const runtime = {
    PATH: "/usr/bin:/bin",
    CLOUDFLARE_API_TOKEN: "explicit-runtime-token",
  };

  const environments = migrationEnvironments(local, runtime);

  assert.equal(environments.source.SUPABASE_SERVICE_ROLE_KEY, "local-source-key");
  assert.equal(environments.source.CLOUDFLARE_API_TOKEN, "explicit-runtime-token");
  assert.deepEqual(environments.wrangler, runtime);
  assert.equal(migrationEnvironments(local, { PATH: runtime.PATH }).wrangler.CLOUDFLARE_API_TOKEN, undefined);
});

test("package exposes one reviewed content-image migration command", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["migrate:content-images"], "node tools/migrate-content-assets-to-r2.mjs");
});
