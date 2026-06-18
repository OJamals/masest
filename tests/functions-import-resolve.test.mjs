import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

// Importing a module resolves its (static) imports — which is exactly what the
// Cloudflare Pages esbuild bundler does at deploy time. A wrong relative path
// (e.g. ../../_lib vs ../_lib) passes `node --check` and source-grep tests but
// fails the build. This guard catches that class of bug in CI.

function jsFiles(dirUrl, base = "") {
  const out = [];
  for (const e of readdirSync(dirUrl, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...jsFiles(new URL(e.name + "/", dirUrl), base + e.name + "/"));
    else if (e.name.endsWith(".js")) out.push(base + e.name);
  }
  return out;
}

const apiRoot = new URL("../functions/api/", import.meta.url);
const files = jsFiles(apiRoot);

test("every functions/api module resolves its imports", async () => {
  assert.ok(files.length > 0, "should discover function files");
  for (const f of files) {
    await assert.doesNotReject(
      () => import(new URL(f, apiRoot).href),
      `unresolved import in functions/api/${f}`,
    );
  }
});
