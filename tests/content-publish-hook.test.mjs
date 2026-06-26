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
  assert.match(env, /CONTENT_PUBLISH_HOOK_URL/);
});
