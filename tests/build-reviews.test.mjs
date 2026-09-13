import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { reviewTargets } from "../tools/build-reviews.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const TOOL = new URL("../tools/build-reviews.mjs", import.meta.url).pathname;

// The tool writes data/reviews.json relative to cwd, so it runs against a throwaway copy of
// the two catalog files it reads. Nothing in the repo is touched.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "build-reviews-"));
  mkdirSync(join(dir, "data"));
  for (const file of ["catalog.seed.json", "services.json"]) {
    cpSync(new URL(`data/${file}`, root).pathname, join(dir, "data", file));
  }
  return dir;
}

// Must not be execFileSync: the stub server below lives in this process, so a blocking
// child would hold the event loop and every request would hang until the tool's timeout.
async function runIn(dir, env) {
  const { stdout } = await execFileAsync(process.execPath, [TOOL], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  let snapshot = null;
  try {
    snapshot = JSON.parse(readFileSync(join(dir, "data", "reviews.json"), "utf8"));
  } catch { /* asserted by the caller */ }
  return { stdout, snapshot };
}

async function withStub(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("review targets cover every catalog product and service", () => {
  const targets = reviewTargets();
  const products = JSON.parse(read("data/catalog.seed.json")).products;
  const services = JSON.parse(read("data/services.json")).services;

  assert.equal(targets.filter((t) => t.kind === "product").length, products.length);
  assert.equal(targets.filter((t) => t.kind === "service").length, services.length);
  // Products are keyed by catalog slug, which is what seo-inject's commerceSku() resolves
  // to and what the rendered review widget carries in data-sku.
  assert.ok(targets.some((t) => t.kind === "product" && t.sku === "cr-hd"));
  assert.equal(targets.every((t) => t.sku.trim()), true);
});

test("aggregates come from the public endpoint, with no Supabase credential", async () => {
  const dir = sandbox();
  try {
    const seen = [];
    const { stdout, snapshot } = await withStub((req, res) => {
      const url = new URL(req.url, "http://stub");
      const kind = url.searchParams.get("kind");
      const sku = url.searchParams.get("sku");
      seen.push(`${kind}:${sku}`);
      if (sku === "cr60") {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end('{"error":"not_found"}');
      }
      const stats = sku === "multiwash" ? { avg: 4.7, count: 12 }
        : sku === "cr-hd" ? { avg: 5, count: 3 }
          : { avg: 0, count: 0 };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, stats: { ...stats, dist: {} }, reviews: [] }));
    }, (origin) => runIn(dir, { REVIEWS_BASE_URL: origin }));

    assert.deepEqual(snapshot, {
      "product:cr-hd": { avg: 5, count: 3 },
      "product:multiwash": { avg: 4.7, count: 12 },
    });
    // An unpublished SKU 404s and a SKU with no approved reviews reports zero; neither is
    // an error and neither may invent a rating.
    assert.ok(seen.includes("product:cr60"));
    assert.ok(seen.length > 40, "every catalog target is asked for");
    assert.match(stdout, /wrote 2 aggregates/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreachable reviews API writes an empty snapshot and still exits 0", async () => {
  const dir = sandbox();
  try {
    // Port 0 is never listening; the tool must not take the build down over review metadata.
    const { stdout, snapshot } = await runIn(dir, { REVIEWS_BASE_URL: "http://127.0.0.1:1" });
    assert.deepEqual(snapshot, {});
    assert.match(stdout, /could not reach the reviews API/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the build reads reviews over HTTP so the service-role key stays in the runtime", () => {
  // functions/api/reviews.js holds the privileged credential and filters to approved rows
  // server-side. tests/github-pages-deploy.test.mjs forbids that key in the deploy
  // workflow; this keeps the build from needing it in the first place.
  // Checked against code, not prose: the file's header explains the boundary and names the
  // key while doing exactly the opposite of reading it.
  const tool = read("tools/build-reviews.mjs").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.doesNotMatch(tool, /createClient|@supabase\/supabase-js/);
  assert.doesNotMatch(tool, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(tool, /\/api\/reviews\?kind=/);
  assert.doesNotMatch(read(".github/workflows/verify.yml"), /SUPABASE_SERVICE_ROLE_KEY/);
});
