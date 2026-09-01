import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  MEDIA_ROUTE_GLOBS,
  R2_MEDIA_GLOB,
  SUPABASE_STORAGE_GLOB,
  createMediaIsolation,
  liveMediaEnabled,
  mediaRequestAction,
  wrapBrowserWithMediaIsolation,
} from "../tools/test-media-isolation.mjs";

const MANAGED_IMAGE = "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/site/img/proof/brewery.webp";
const R2_IMAGE = "https://media.masest.co/site/img/proof/brewery.webp";
const SCAN_SKIP_DIRS = new Set([
  ".claude",
  ".git",
  "_local",
  "artifacts",
  "audits",
  "dist",
  "node_modules",
  "test-results",
]);

function repositoryModules(directory, relativePath = "") {
  const modules = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      modules.push(...repositoryModules(
        new URL(`${entry.name}/`, directory),
        `${relativePath}${entry.name}/`,
      ));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      modules.push({
        name: `${relativePath}${entry.name}`,
        source: readFileSync(new URL(entry.name, directory), "utf8"),
      });
    }
  }
  return modules;
}

function activeBrowserModules() {
  const root = new URL("../", import.meta.url);
  const rootModules = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => ({
      name: entry.name,
      source: readFileSync(new URL(entry.name, root), "utf8"),
    }));
  return [
    ...rootModules,
    ...repositoryModules(new URL("../tools/", import.meta.url), "tools/"),
    ...repositoryModules(new URL("../tests/", import.meta.url), "tests/"),
  ];
}

test("live Supabase media requires explicit local opt-in and stays disabled in CI", () => {
  assert.equal(liveMediaEnabled({}), false);
  assert.equal(liveMediaEnabled({ MASEST_LIVE_MEDIA: "1" }), true);
  assert.equal(liveMediaEnabled({ MASEST_LIVE_MEDIA: "true" }), true);
  assert.equal(liveMediaEnabled({ MASEST_LIVE_MEDIA: "1", CI: "true" }), false);
});

test("media isolation placeholders managed site images and blocks other storage", () => {
  assert.equal(mediaRequestAction(MANAGED_IMAGE, "GET"), "placeholder");
  assert.equal(mediaRequestAction(`${MANAGED_IMAGE}?download=1`, "HEAD"), "placeholder");
  assert.equal(mediaRequestAction(MANAGED_IMAGE, "POST"), "block");
  assert.equal(mediaRequestAction(R2_IMAGE, "GET"), "placeholder");
  assert.equal(mediaRequestAction(`${R2_IMAGE}?v=1`, "HEAD"), "placeholder");
  assert.equal(mediaRequestAction(R2_IMAGE, "POST"), "block");
  assert.equal(mediaRequestAction(
    "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/technical-documents/sds.pdf",
    "GET",
  ), "block");
  assert.equal(mediaRequestAction("https://masest.co/img/proof/brewery.webp", "GET"), "pass");
});

test("media isolation fulfills managed image requests without network egress", async () => {
  const routes = new Map();
  const target = {
    async route(nextPattern, nextHandler) {
      routes.set(nextPattern, nextHandler);
    },
  };
  const isolation = createMediaIsolation({ env: {} });
  await isolation.install(target);

  assert.deepEqual([...routes.keys()], MEDIA_ROUTE_GLOBS);
  const handler = routes.get(SUPABASE_STORAGE_GLOB);
  assert.equal(typeof handler, "function");

  let fulfilled;
  await handler({
    request: () => ({ method: () => "GET", url: () => MANAGED_IMAGE }),
    fulfill: async (response) => { fulfilled = response; },
    abort: async () => assert.fail("managed media must not be aborted"),
  });

  assert.equal(fulfilled.status, 200);
  assert.equal(fulfilled.contentType, "image/png");
  assert.ok(Buffer.isBuffer(fulfilled.body));
  assert.ok(fulfilled.body.length > 0);
  isolation.assertNoUnexpected();

  let r2Fulfilled;
  await routes.get(R2_MEDIA_GLOB)({
    request: () => ({ method: () => "GET", url: () => R2_IMAGE }),
    fulfill: async (response) => { r2Fulfilled = response; },
    abort: async () => assert.fail("managed R2 media must not be aborted"),
  });
  assert.equal(r2Fulfilled.status, 200);
});

test("media isolation aborts and reports unexpected Supabase storage", async () => {
  let handler;
  const target = {
    async route(_pattern, nextHandler) { handler = nextHandler; },
  };
  const isolation = createMediaIsolation({ env: {} });
  await isolation.install(target);

  let abortCode = "";
  const url = "https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/technical-documents/sds.pdf";
  await handler({
    request: () => ({ method: () => "GET", url: () => url }),
    fulfill: async () => assert.fail("unexpected storage must not be fulfilled"),
    abort: async (code) => { abortCode = code; },
  });

  assert.equal(abortCode, "blockedbyclient");
  assert.throws(
    () => isolation.assertNoUnexpected(),
    /Blocked unexpected managed media requests:\nGET https:\/\/mvfxzvkzcqmnwcoblvfc\.supabase\.co/,
  );
});

test("browser wrapper installs isolation on direct pages and contexts", async () => {
  const installed = [];
  const target = () => ({
    async route(pattern, handler) { installed.push({ pattern, handler }); },
  });
  let closed = 0;
  const browser = {
    async newPage() { return target(); },
    async newContext() { return target(); },
  };
  const wrapped = wrapBrowserWithMediaIsolation(browser, {
    env: {},
    close: async () => { closed += 1; },
  });

  await wrapped.newPage();
  await wrapped.newContext();
  assert.deepEqual(installed.map(({ pattern }) => pattern), [
    SUPABASE_STORAGE_GLOB,
    R2_MEDIA_GLOB,
    SUPABASE_STORAGE_GLOB,
    R2_MEDIA_GLOB,
  ]);
  await wrapped.close();
  assert.equal(closed, 1);
});

test("all Playwright specs use the egress-safe shared fixture", () => {
  const toolsRoot = new URL("../tools/", import.meta.url);
  const specFiles = readdirSync(toolsRoot)
    .filter((name) => name.endsWith(".spec.mjs"))
    .sort();

  assert.ok(specFiles.length > 0, "should discover Playwright specs");
  const directImports = specFiles.filter((name) => (
    /from\s+["']@playwright\/test["']/.test(readFileSync(new URL(name, toolsRoot), "utf8"))
  ));
  assert.deepEqual(directImports, []);
});

test("active browser launchers and manual Playwright contexts install media isolation", () => {
  const modules = activeBrowserModules();

  const directLaunchers = modules.filter(({ source }) => /chromium\.launch(?:Server)?\(/.test(source));
  assert.ok(directLaunchers.length > 0, "should discover direct Chromium launchers");
  for (const { name, source } of directLaunchers) {
    assert.match(source, /wrapBrowserWithMediaIsolation/, `${name} must wrap direct Chromium launches`);
  }

  const manualContextSpecs = modules.filter(({ name, source }) => (
    name.startsWith("tools/") && name.endsWith(".spec.mjs") && /browser\.newContext\(/.test(source)
  ));
  for (const { name, source } of manualContextSpecs) {
    assert.match(source, /createMediaIsolation/, `${name} must guard manual browser contexts`);
    assert.match(source, /\.install\(context\)/, `${name} must install guard before navigation`);
  }
});
