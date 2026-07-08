import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { triggerContentPublishBuild } from "../functions/_lib/content.js";

const entry = {
  type: "service",
  slug: "water-analysis",
  locale: "en",
  status: "published",
  version: 4,
  title: "Water analysis",
};

test("publish hook posts CMS publish identity to the configured deploy hook", async () => {
  const calls = [];
  const result = await triggerContentPublishBuild(
    { CONTENT_PUBLISH_HOOK_URL: "https://deploy.example/hooks/cms" },
    entry,
    async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    },
  );

  assert.deepEqual(result, { ok: true, skipped: false, status: 202 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://deploy.example/hooks/cms");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    source: "cms_publish",
    type: "service",
    slug: "water-analysis",
    locale: "en",
    status: "published",
    version: 4,
  });
});

test("publish hook reports skipped when no deploy hook is configured", async () => {
  let called = false;
  const result = await triggerContentPublishBuild({}, entry, async () => {
    called = true;
    return new Response("unexpected", { status: 500 });
  });

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(called, false);
});

test("publish hook reports non-blocking failure details", async () => {
  const result = await triggerContentPublishBuild(
    { CLOUDFLARE_PAGES_DEPLOY_HOOK_URL: "https://deploy.example/hooks/cms" },
    entry,
    async () => new Response("rate limited", { status: 429 }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.status, 429);
  assert.match(result.error, /deploy_hook_failed/);
});

test("content publish API and editor surface static rebuild hook state", () => {
  const api = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(api, /triggerContentPublishBuild/);
  assert.match(api, /publish_hook/);
  assert.match(ui, /publish_hook/);
  assert.match(ui, /Static rebuild/);
  assert.match(ui, /public pages keep the previous export until a build runs/);
  assert.match(ui, /publishStatusKind/);
  assert.match(ui, /hook\?\.skipped\) return "warn"/);
  assert.match(env, /CONTENT_PUBLISH_HOOK_URL/);
});

import { triggerBlogPublishWorkflow } from "../functions/_lib/content.js";

const blogEntry = { type: "blog_post", slug: "hello", status: "published" };

test("blog workflow dispatch: no-op for non-blog_post types", async () => {
  let called = false;
  const res = await triggerBlogPublishWorkflow({ GITHUB_DISPATCH_TOKEN: "t" },
    { type: "service", slug: "x" }, async () => { called = true; return { ok: true, status: 204 }; });
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(called, false);
});

test("blog workflow dispatch: no-op without a token", async () => {
  let called = false;
  const res = await triggerBlogPublishWorkflow({}, blogEntry, async () => { called = true; return { ok: true }; });
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(called, false);
});

test("blog workflow dispatch: POSTs a content-published repository_dispatch when configured", async () => {
  let captured = null;
  const res = await triggerBlogPublishWorkflow(
    { GITHUB_DISPATCH_TOKEN: "tok", GITHUB_DISPATCH_REPO: "OJamals/masest" },
    blogEntry,
    async (url, opts) => { captured = { url, opts }; return { ok: true, status: 204 }; },
  );
  assert.equal(res.ok, true);
  assert.equal(res.skipped, false);
  assert.equal(captured.url, "https://api.github.com/repos/OJamals/masest/dispatches");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.authorization, "Bearer tok");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.event_type, "content-published");
  assert.equal(body.client_payload.slug, "hello");
});

test("blog workflow dispatch: reports a failed dispatch", async () => {
  const res = await triggerBlogPublishWorkflow({ GITHUB_DISPATCH_TOKEN: "tok" }, blogEntry,
    async () => ({ ok: false, status: 401 }));
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.error, "github_dispatch_failed");
});

import { triggerSeoPublishWorkflow } from "../functions/_lib/content.js";

test("seo workflow dispatch: no-op for non-page_meta types", async () => {
  let called = false;
  const res = await triggerSeoPublishWorkflow({ GITHUB_DISPATCH_TOKEN: "t" },
    { type: "blog_post", slug: "x" }, async () => { called = true; return { ok: true, status: 204 }; });
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(called, false);
});

test("seo workflow dispatch: POSTs a seo-published dispatch for page_meta when configured", async () => {
  let captured = null;
  const res = await triggerSeoPublishWorkflow(
    { GITHUB_DISPATCH_TOKEN: "tok", GITHUB_DISPATCH_REPO: "OJamals/masest" },
    { type: "page_meta", slug: "about", status: "published" },
    async (url, opts) => { captured = { url, opts }; return { ok: true, status: 204 }; },
  );
  assert.equal(res.ok, true);
  assert.equal(res.skipped, false);
  assert.equal(captured.url, "https://api.github.com/repos/OJamals/masest/dispatches");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.event_type, "seo-published");
  assert.equal(body.client_payload.slug, "about");
});

test("seo workflow dispatch: no-op without a token", async () => {
  let called = false;
  const res = await triggerSeoPublishWorkflow({}, { type: "page_meta", slug: "x" },
    async () => { called = true; return { ok: true }; });
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(called, false);
});
