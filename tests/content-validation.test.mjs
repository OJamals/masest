import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeContentEntry,
  publicContentSnapshot,
  validateContentEntry,
} from "../functions/_lib/content.js";
import { onRequest as contentAdminRequest } from "../functions/api/admin/content.js";

test("content schema defines entries, revisions, assets, and statuses", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /create type content_status as enum \('draft','published','archived'\)/);
  assert.match(sql, /create table if not exists public\.content_entries/);
  assert.match(sql, /create table if not exists public\.content_revisions/);
  assert.match(sql, /create table if not exists public\.content_assets/);
  assert.match(sql, /payload\s+jsonb\s+not null/);
  assert.match(sql, /seo\s+jsonb\s+not null default '\{\}'::jsonb/);
});

test("content validation accepts supported first-slice content types", () => {
  const entry = normalizeContentEntry({
    type: "service",
    slug: "raw-water-standard-analysis",
    title: "Raw Water - Standard Analysis",
    status: "draft",
    payload: {
      sku: "MS-LAB-WTR-RAW-WATER-STANDARD-ANALYSIS",
      category: "Lab Testing - Water Analysis",
      unit: "per sample",
      public_price: 278.57,
      active: true,
    },
    seo: { description: "Water analysis service for industrial buyers." },
  });

  assert.equal(entry.type, "service");
  assert.equal(entry.locale, "en");
  assert.equal(validateContentEntry(entry).ok, true);
});

test("content validation rejects commerce-owned product data", () => {
  const result = validateContentEntry({
    type: "product",
    slug: "hcr",
    title: "VertKleen HCR",
    payload: { price: 17.3, mode: "buy" },
    seo: {},
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported content type/i);
});

test("public snapshots omit draft-only metadata", () => {
  const snapshot = publicContentSnapshot([
    normalizeContentEntry({
      type: "service_package",
      slug: "initial-sampling-visit-package",
      title: "Initial Sampling Visit Package",
      status: "published",
      payload: { sku: "MS-PKG-INITIAL-SAMPLING-VISIT-PACKAGE", active: true },
      seo: {},
      version: 4,
    }),
  ]);

  assert.deepEqual(Object.keys(snapshot), ["service_package"]);
  assert.equal(snapshot.service_package[0].slug, "initial-sampling-visit-package");
  assert.equal(snapshot.service_package[0].version, undefined);
});

test("admin content API source requires staff and content repository", () => {
  const source = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /createContentRepository/);
  assert.match(source, /createContentPublicationLifecycle/);
  assert.match(lifecycle, /capability:\s*"content\.write"/);
  assert.match(lifecycle, /staffCan\(role, policy\.capability\)/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /request\.method === "DELETE"/);
});

test("admin content API lists drafts when the status filter is all", async () => {
  const originalFetch = globalThis.fetch;
  let contentQuery;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ user: { id: "owner-id", email: "owner@example.com" } });
    }
    if (url.pathname === "/rest/v1/content_entries") {
      contentQuery = url;
      const entries = url.searchParams.has("status")
        ? []
        : [{
            id: "shipping-draft-id",
            type: "shipping_rate",
            slug: "ground",
            title: "Ground shipping",
            status: "draft",
            locale: "en",
            payload: { stripe_rate_id: "shr_ground", active: false },
            seo: {},
          }];
      return Response.json(entries);
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  };

  try {
    const response = await contentAdminRequest({
      request: new Request(
        "https://masest.co/api/admin/content?type=shipping_rate&status=all",
        { headers: { authorization: "Bearer owner-token" } },
      ),
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        ADMIN_EMAILS: "owner@example.com",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(contentQuery.searchParams.has("status"), false);
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].status, "draft");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin shell exposes a native Content tab and panel", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="content"/);
  assert.match(html, /data-panel="content"/);
  assert.match(html, /id="admContent"/);
});

test("admin shell exposes a dedicated Blog tab in Publishing", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="blog"/);
  assert.match(html, /data-panel="blog"/);
  assert.match(html, /id="admBlog"/);
  assert.match(html, /Publishing[\s\S]*data-tab="blog"[\s\S]*data-tab="newsletter"/);
});

test("admin content module is registered with lazy render and wire hooks", () => {
  const admin = readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");
  const module = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");

  assert.match(admin, /import\(\s*'\.\/admin\/content\.js\?v=\d{8}[a-z]'\s*\)/);
  assert.match(admin, /content:\s*async\s*\(\)\s*=>/);
  assert.match(admin, /options\.tab === 'blog'\s*\?\s*renderBlog\(options\)\s*:\s*renderContent\(options\)/);
  assert.match(admin, /wireContent\(\)/);
  assert.match(admin, /wireBlog\(\)/);
  assert.match(module, /export function createContentTab/);
  assert.match(module, /renderBlog/);
  assert.match(module, /\/api\/admin\/content/);
  assert.match(module, /JSON\.parse/);
  assert.match(module, /publish:\s*true/);
});

test("admin content editor normalizes slugs without clobbering manual edits", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /slugifyContentTitle/);
  assert.match(source, /syncSlugFromTitle/);
  assert.match(source, /normalizeManualSlug/);
  assert.match(source, /slugManuallyEdited/);
  assert.match(source, /#contentTitle/);
  assert.match(source, /#contentSlug/);
});

test("admin CMS page fields use canonical sitemap suggestions", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentPageOptionsFromSitemap/);
  assert.match(source, /fetch\(["']\/sitemap\.xml["']/);
  assert.match(source, /list="contentPageOptions"/);
});
