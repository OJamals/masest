import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("package exposes one-command build and verification scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts || {};

  assert.match(scripts.check || "", /node tools\/check-js\.mjs/);
  assert.match(scripts.test || "", /node --test --test-concurrency=1 --test-timeout=\d+ tests\/\*\.test\.mjs/);
  assert.match(scripts.build || "", /node tools\/cf-build\.mjs/);
  assert.match(scripts.verify || "", /npm run check && npm test && npm run build/);
  assert.match(scripts.serve || "", /python3 -m http\.server 4195/);
  assert.match(scripts["smoke:admin"] || "", /playwright test tools\/admin-auth-gate\.spec\.mjs/);
});

test("Cloudflare build emits baseline security headers", () => {
  const build = read("tools/cf-build.mjs");

  assert.match(build, /X-Content-Type-Options:\s*nosniff/);
  assert.match(build, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(build, /X-Frame-Options:\s*SAMEORIGIN/);
  assert.match(build, /Strict-Transport-Security:/);
  assert.match(build, /Permissions-Policy:/);
});

test("architecture doc captures current app boundaries and target structure", () => {
  assert.equal(existsSync(new URL("docs/ARCHITECTURE.md", root)), true);
  const doc = read("docs/ARCHITECTURE.md");

  assert.match(doc, /Cloudflare Pages/i);
  assert.match(doc, /Pages Functions/i);
  assert.match(doc, /Supabase/i);
  assert.match(doc, /js\/main\/\*/);
  assert.match(doc, /js\/admin\/qbo\.js/);
  assert.match(doc, /Quote CRM/i);
  assert.match(doc, /npm run verify/);
  assert.match(doc, /No redesign/i);
});
