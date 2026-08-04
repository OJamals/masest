import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("package exposes one-command build and verification scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts || {};
  const criticalUiSpecs = [
    "tools/focus-visible-a11y.spec.mjs",
    "tools/service-tabs-a11y.spec.mjs",
    "tools/site-audit-regressions.spec.mjs",
    "tools/story-hmis-visual.spec.mjs",
  ];

  assert.match(scripts.check || "", /node tools\/check-js\.mjs/);
  assert.match(scripts.test || "", /node --test --test-concurrency=1 --test-timeout=\d+ tests\/\*\.test\.mjs/);
  assert.match(scripts.build || "", /node tools\/cf-build\.mjs/);
  assert.match(scripts.verify || "", /npm run check && npm test && npm run build/);
  assert.match(scripts.verify || "", /npm run qa:commerce-smoke/);
  assert.equal(
    scripts["qa:ui-critical"],
    `playwright test ${criticalUiSpecs.join(" ")} --reporter=line`,
  );
  assert.doesNotMatch(scripts["qa:ui-critical"], /tools\/\*\.spec/);
  assert.ok(
    scripts.verify.indexOf("npm run build")
      < scripts.verify.indexOf("npm run verify:site"),
    "built-site validation must follow the build",
  );
  assert.ok(
    scripts.verify.indexOf("npm run verify:site")
      < scripts.verify.indexOf("npm run qa:commerce-smoke"),
    "commerce smoke must follow built-site validation",
  );
  assert.ok(
    scripts.verify.indexOf("npm run qa:commerce-smoke")
      < scripts.verify.indexOf("npm run qa:ui-critical"),
    "critical UI gate must follow built-site and commerce validation",
  );
  assert.match(scripts.serve || "", /python3 -m http\.server 4195/);
  assert.match(scripts["smoke:admin"] || "", /playwright test tools\/admin-auth-gate\.spec\.mjs/);
  for (const spec of [
    "commerce-states",
    "product-buy",
    "commerce-cart",
    "cart-checkout-redirect",
    "contact-prefill",
  ]) {
    assert.match(scripts["qa:commerce-smoke"] || "", new RegExp(`tools/${spec}\\.spec\\.mjs`));
  }
});

test("Cloudflare build emits baseline security headers", () => {
  const build = read("tools/cf-build.mjs");

  assert.match(build, /X-Content-Type-Options:\s*nosniff/);
  assert.match(build, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(build, /X-Frame-Options:\s*SAMEORIGIN/);
  assert.match(build, /Strict-Transport-Security:/);
  assert.match(build, /Permissions-Policy:/);
  assert.match(build, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/, "Turnstile script must be allowed for auth forms");
  assert.match(build, /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/, "Turnstile network requests must be allowed for auth forms");
  assert.doesNotMatch(build, /crisp\.chat/i, "removed third-party chat domains must not remain in CSP");
  assert.match(build, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/, "Cloudflare analytics script must be allowed when Pages injects it");
  assert.match(build, /connect-src[^;]*https:\/\/cloudflareinsights\.com/, "Cloudflare analytics beacon must be allowed when Pages injects it");
  assert.match(build, /script-src[^;]*https:\/\/\*\.googleapis\.com[^;]*https:\/\/\*\.gstatic\.com/, "Google Places scripts must be allowed");
  assert.match(build, /connect-src[^;]*https:\/\/\*\.googleapis\.com[^;]*https:\/\/\*\.gstatic\.com/, "Google Places requests must be allowed");
  assert.match(build, /font-src[^;]*https:\/\/fonts\.gstatic\.com/, "Google Places fonts must be allowed");
  assert.match(build, /style-src[^;]*https:\/\/fonts\.googleapis\.com/, "Google Places styles must be allowed");
  assert.match(build, /frame-src\s+'self'[^;]*https:\/\/challenges\.cloudflare\.com/, "same-origin CMS field check iframe must be allowed");
  assert.match(build, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/, "Turnstile frame must be allowed for auth forms");
});

test("Cloudflare build excludes internal research and audit artifacts", () => {
  const build = read("tools/cf-build.mjs");

  assert.match(
    build,
    /git ls-files --cached --others --exclude-standard/,
    "local builds must exercise unignored new site files before commit",
  );
  assert.match(build, /\^factory\\\//, "Loop Factory run artifacts must not publish");
  assert.match(build, /\^audit-\[\^\/\]\+\\\/\//, "dated audit capture folders must not publish");
  assert.match(build, /\^audits\?\\\/\//, "generic audit capture folders must not publish");
  assert.match(build, /\^masest\\\.co-audit\\\//, "downloaded site audit captures must not publish");
  assert.match(build, /\^docs\\\/research\\\//, "research sources and generated candidates must not publish");
});

test("HTML pages link shared stylesheet with a cache-buster", () => {
  const pages = [
    ...readdirSync(root).filter((name) => name.endsWith(".html")),
    ...readdirSync(new URL("industries/", root)).filter((name) => name.endsWith(".html")).map((name) => `industries/${name}`),
  ].sort();
  for (const page of pages) {
    const html = read(page);
    const match = html.match(/css\/style\.css\?v=([^"']+)/);
    assert.ok(match, `${page} must link css/style.css with cache-buster`);
    assert.match(match[1], /^[0-9]{8}[a-z]?$/i, `${page} must use a date-like style.css cache-buster`);
  }
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
