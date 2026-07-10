import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const RELEASE = "20260710f";
const MAIN_RELEASE_OVERRIDES = new Map([
  ["admin.html", "20260710g"],
  ["dashboard.html", "20260710g"],
]);
const DASHBOARD_RELEASE = MAIN_RELEASE_OVERRIDES.get("dashboard.html");

function filesUnder(path) {
  return readdirSync(new URL(path, root), { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}${entry.name}`;
    if (entry.isDirectory()) {
      if ([".git", "backups", "dist", "node_modules"].includes(entry.name)) return [];
      return filesUnder(`${child}/`);
    }
    return [child];
  });
}

test("every browser auth importer uses one cache release", () => {
  const files = [
    ...filesUnder("js/").filter((path) => path.endsWith(".js")),
    "account.html",
    "product.html",
  ];
  let references = 0;

  for (const path of files) {
    const source = read(path);
    const imports = source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']*auth\.js(?:\?[^"']*)?)["']/g);
    for (const match of imports) {
      references += 1;
      assert.match(match[1], new RegExp(`auth\\.js\\?v=${RELEASE}$`), `${path}: ${match[1]}`);
    }
  }

  assert.ok(references >= 10, "expected all public, dashboard, and admin auth consumers");
});

test("auth-consuming module paths are refreshed from their page entrypoints", () => {
  assert.match(read("dashboard.html"), new RegExp(`dashboard\\.js\\?v=${DASHBOARD_RELEASE}`));
  assert.match(read("js/dashboard.js"), new RegExp(`business\\.js\\?v=${DASHBOARD_RELEASE}`));

  assert.match(read("admin.html"), new RegExp(`admin\\.js\\?v=${RELEASE}`));
  for (const module of ["content", "products", "qbo"]) {
    assert.match(read("js/admin.js"), new RegExp(`admin/${module}\\.js\\?v=${RELEASE}`));
  }

  assert.match(read("js/main/chrome.js"), new RegExp(`account-nav\\.js\\?v=${RELEASE}`));
  assert.match(read("js/main/chrome.js"), new RegExp(`integrations\\.js\\?v=${RELEASE}`));
  assert.match(read("js/main/service-catalog.js"), new RegExp(`reviews\\.js\\?v=${RELEASE}`));
  assert.match(read("product.html"), new RegExp(`reviews\\.js\\?v=${RELEASE}`));
});

test("account login button and form submit share the same handler", () => {
  const account = read("account.html");

  assert.match(account, /async function handleLoginSubmit\(e\)/);
  assert.match(account, /\$\("loginForm"\)\.addEventListener\("submit", handleLoginSubmit\)/);
  assert.match(account, /function handleLoginButtonClick\(e\)[\s\S]*closest\?\.\("#liBtn"\)/);
  assert.match(account, /document\.addEventListener\("click", handleLoginButtonClick, true\)/);
});

test("public pages and generators publish the auth cache release", () => {
  const htmlFiles = [
    ...filesUnder("").filter((path) => path.endsWith(".html") && !path.startsWith("node_modules/")),
  ];
  let entrypoints = 0;

  for (const path of htmlFiles) {
    const matches = [...read(path).matchAll(/main\.js\?v=(\d{8}[a-z])/g)];
    for (const match of matches) {
      entrypoints += 1;
      assert.equal(match[1], MAIN_RELEASE_OVERRIDES.get(path) || RELEASE, path);
    }
  }

  for (const path of [
    "tools/build-blog.mjs",
    "tools/gen_comparisons.mjs",
    "tools/gen_industries.mjs",
    "tools/seo-inject.mjs",
  ]) {
    assert.doesNotMatch(read(path), new RegExp(`main\\.js\\?v=(?!${RELEASE})`), path);
  }
  assert.ok(entrypoints >= 50, "expected generated and hand-authored public pages");
});
