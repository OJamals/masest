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

test("publish hook dispatches general CMS changes to the OJamals deployment workflow", async () => {
  const calls = [];
  const result = await triggerContentPublishBuild(
    { GITHUB_DISPATCH_TOKEN: "tok" },
    entry,
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204 };
    },
  );

  assert.deepEqual(result, { ok: true, skipped: false, status: 204 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/OJamals/masest/dispatches");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    event_type: "site-content-published",
    client_payload: {
      source: "cms_publish",
      type: "service",
      slug: "water-analysis",
      locale: "en",
      status: "published",
      version: 4,
    },
  });
});

test("publish hook reports skipped when GitHub dispatch is not configured", async () => {
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
    { GITHUB_DISPATCH_TOKEN: "tok" },
    entry,
    async () => ({ ok: false, status: 429 }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.status, 429);
  assert.match(result.error, /github_dispatch_failed/);
});

test("content publish API and editor surface static rebuild hook state", () => {
  const api = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(api, /createContentPublicationLifecycle/);
  assert.match(api, /triggerContentPublishBuild/);
  assert.match(api, /publishHook:\s*\(entry\)\s*=>\s*triggerContentPublishBuild\(env, entry\)/);
  assert.match(lifecycle, /result\.entry\?\.type === "blog_post"/);
  assert.match(ui, /publish_hook/);
  assert.match(ui, /Static rebuild/);
  assert.match(ui, /public pages keep the previous export until a build runs/);
  assert.match(ui, /publishStatusKind/);
  assert.match(ui, /hook\?\.skipped\) return "warn"/);
  assert.match(env, /GITHUB_DISPATCH_TOKEN/);
  assert.match(env, /GITHUB_DISPATCH_REPO=OJamals\/masest/);
});

test("content archive delegates the static rebuild hook to the publication lifecycle", () => {
  const api = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");

  assert.match(api, /publication\.archive\(/);
  assert.match(lifecycle, /async function archive\(/);
  assert.match(lifecycle, /result\.entry\?\.type === "blog_post"/);
  assert.match(lifecycle, /result\.blog_workflow\s*=\s*await blogWorkflow\(result\.entry\)/);
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
    { GITHUB_DISPATCH_TOKEN: "tok" },
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
