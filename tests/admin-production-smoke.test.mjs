import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAdminProductionConfig,
  probeProductionAdmin,
} from "../tools/admin-production-smoke.mjs";

const BASE_URL = "https://masest.co";
const SCRIPT_SRC = "js/admin.js?v=20260830h";

function adminHtml(scriptSrc = SCRIPT_SRC) {
  return `<!doctype html>
    <section id="admGate"></section>
    <section id="admApp" hidden></section>
    <script type="module" src="${scriptSrc}"></script>`;
}

test("production smoke uses anonymous GET requests and accepts the fail-closed admin gate", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === `${BASE_URL}/admin`) {
      return new Response(adminHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (String(url) === `${BASE_URL}/api/admin/stats`) {
      return Response.json(
        { error: "unauthenticated" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    throw new Error(`unexpected request ${url}`);
  };

  const result = await probeProductionAdmin(
    loadAdminProductionConfig({ ADMIN_PRODUCTION_BASE_URL: BASE_URL }),
    { expectedScriptSrc: SCRIPT_SRC, fetchImpl, attempts: 1, sleep: async () => {} },
  );

  assert.deepEqual(result, {
    baseUrl: BASE_URL,
    adminScriptSrc: SCRIPT_SRC,
    adminApiStatus: 401,
  });
  assert.deepEqual(calls.map((call) => call.url), [
    `${BASE_URL}/admin`,
    `${BASE_URL}/api/admin/stats`,
  ]);
  for (const { options } of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(new Headers(options.headers).has("authorization"), false);
    assert.equal(options.redirect, "error");
  }
});

test("production smoke rejects an admin API that permits anonymous access", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/admin")) {
      return new Response(adminHtml(), { status: 200, headers: { "content-type": "text/html" } });
    }
    return Response.json({ orders: [] }, { status: 200, headers: { "cache-control": "no-store" } });
  };

  await assert.rejects(
    () => probeProductionAdmin(
      loadAdminProductionConfig({ ADMIN_PRODUCTION_BASE_URL: BASE_URL }),
      { expectedScriptSrc: SCRIPT_SRC, fetchImpl, attempts: 1, sleep: async () => {} },
    ),
    (error) => error?.code === "admin_production_api_not_gated",
  );
});

test("production smoke rejects stale or malformed deployed admin HTML", async () => {
  const fetchImpl = async () => new Response(adminHtml("js/admin.js?v=stale"), {
    status: 200,
    headers: { "content-type": "text/html" },
  });

  await assert.rejects(
    () => probeProductionAdmin(
      loadAdminProductionConfig({ ADMIN_PRODUCTION_BASE_URL: BASE_URL }),
      { expectedScriptSrc: SCRIPT_SRC, fetchImpl, attempts: 2, sleep: async () => {} },
    ),
    (error) => error?.code === "admin_production_release_mismatch",
  );
});

test("production smoke only targets the canonical production origin", () => {
  assert.throws(
    () => loadAdminProductionConfig({ ADMIN_PRODUCTION_BASE_URL: "https://preview.example.test" }),
    (error) => error?.code === "admin_production_base_forbidden",
  );
  assert.equal(loadAdminProductionConfig({}).baseUrl, BASE_URL);
});
