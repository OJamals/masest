import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  assert.match(build, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/, "Turnstile script must be allowed for auth forms");
  assert.match(build, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/, "Cloudflare analytics script must be allowed when Pages injects it");
  assert.match(build, /connect-src[^;]*https:\/\/cloudflareinsights\.com/, "Cloudflare analytics beacon must be allowed when Pages injects it");
  assert.match(build, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/, "Turnstile frame must be allowed for auth forms");
});

test("Cloudflare build excludes local audit capture artifacts", () => {
  const build = read("tools/cf-build.mjs");

  assert.match(build, /\^audit-\[\^\/\]\+\\\/\//, "dated audit capture folders must not publish");
  assert.match(build, /\^audits\?\\\/\//, "generic audit capture folders must not publish");
  assert.match(build, /\^masest\\\.co-audit\\\//, "downloaded site audit captures must not publish");
});

test("HTML pages use one fresh shared stylesheet cache-buster", () => {
  const pages = [
    ...readdirSync(root).filter((name) => name.endsWith(".html")),
    ...readdirSync(new URL("industries/", root)).filter((name) => name.endsWith(".html")).map((name) => `industries/${name}`),
  ].sort();
  const versions = new Set();
  for (const page of pages) {
    const html = read(page);
    const match = html.match(/css\/style\.css\?v=([^"']+)/);
    assert.ok(match, `${page} must link css/style.css with cache-buster`);
    versions.add(match[1]);
  }
  assert.deepEqual([...versions], ["20260625a"]);
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
