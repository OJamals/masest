import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../cloudflare/www-redirect/src/index.js";

const config = JSON.parse(
  readFileSync(new URL("../cloudflare/www-redirect/wrangler.jsonc", import.meta.url), "utf8"),
);
const buildSource = readFileSync(new URL("../tools/cf-build.mjs", import.meta.url), "utf8");

test("www redirect worker permanently preserves path and query on the apex host", async () => {
  const response = await worker.fetch(
    new Request("https://www.masest.co/products/hcr?utm_source=qa&ref=story"),
  );

  assert.equal(response.status, 301);
  assert.equal(
    response.headers.get("location"),
    "https://masest.co/products/hcr?utm_source=qa&ref=story",
  );
});

test("www redirect worker forces HTTPS and fails closed on unexpected hosts", async () => {
  const redirect = await worker.fetch(new Request("http://www.masest.co/proof"));
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://masest.co/proof");

  const unexpected = await worker.fetch(new Request("https://preview.example/proof"));
  assert.equal(unexpected.status, 404);
  assert.equal(unexpected.headers.get("location"), null);
});

test("www redirect worker route is limited to the duplicate hostname", () => {
  assert.equal(config.name, "masest-www-redirect");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [
    { pattern: "www.masest.co/*", zone_name: "masest.co" },
  ]);
  assert.match(buildSource, /\^cloudflare\\\//, "worker source must stay out of public dist");
});
