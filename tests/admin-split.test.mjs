import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin entrypoint imports QuickBooks controls from a split module", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /from\s+["']\.\/admin\/qbo\.js(?:\?v=\d{8}[a-z])?["']/);
  assert.doesNotMatch(admin, /async function renderQboStatus\s*\(/);
  assert.doesNotMatch(admin, /async function connectQbo\s*\(/);

  const qbo = read("js/admin/qbo.js");
  assert.match(qbo, /export async function renderQboStatus\b/);
  assert.match(qbo, /export async function connectQbo\b/);
  assert.match(qbo, /\/api\/admin\/qbo\/status/);
  assert.match(qbo, /\/api\/admin\/qbo\/connect\?format=json/);
});

test("admin entrypoint wires per-tab split modules (#36)", () => {
  const admin = read("js/admin.js");
  // Each extracted tab must be imported and wired from the entrypoint, and its
  // renderer must no longer be defined inline in admin.js.
  const tabs = [
    { mod: "traffic", factory: "createTrafficRenderer", inline: /function renderTrafficFunnel\s*\(/ },
    { mod: "seo", factory: "createSeoAudit", inline: /async function runSeoAudit\s*\(/ },
    { mod: "threads", factory: "createThreadsTab", inline: /async function renderThreads\s*\(/ },
    { mod: "offers", factory: "createOffersTab", inline: /async function renderOffers\s*\(/ },
    { mod: "products", factory: "createProductsTab", inline: /async function renderProducts\s*\(/ },
    { mod: "pricing", factory: "createPricingTab", inline: /async function renderPricing\s*\(/ },
    // customers tab retired: portal users folded into the CRM People directory (crm-workspace.js)
    { mod: "companies", factory: "createCompaniesTab", inline: /async function renderCompanies\s*\(/ },
    { mod: "orders", factory: "createOrdersTab", inline: /async function renderOrders\s*\(/ },
    { mod: "quotes", factory: "createQuotesTab", inline: /async function renderQuotePipeline\s*\(/ },
  ];
  for (const { mod, factory, inline } of tabs) {
    assert.match(admin, new RegExp(`from\\s+["']\\./admin/${mod}\\.js(?:\\?v=\\d{8}[a-z])?["']`), `admin should import ./admin/${mod}.js`);
    assert.match(admin, new RegExp(`${factory}\\(`), `admin should wire ${factory}`);
    assert.doesNotMatch(admin, inline, `${mod} renderer should not be defined inline in admin.js`);
  }
});

test("admin QuickBooks panel renders failed sync retry controls", () => {
  const html = read("admin.html");
  const qbo = read("js/admin/qbo.js");
  assert.match(html, /qboFailedOrders/);
  assert.match(qbo, /qbo_failed_orders/);
  assert.match(qbo, /qbo_failed_refunds/);
  assert.match(qbo, /refund_sync_counts/);
  assert.match(qbo, /data-qbo-retry/);
  assert.match(qbo, /data-qbo-retry-kind/);
  assert.match(qbo, /\/api\/admin\/qbo\/retry/);
});

test("admin split modules used by the shell are cache-busted", () => {
  const admin = read("js/admin.js");
  const imports = [...admin.matchAll(/from\s+["']\.\/admin\/([^"']+?\.js)([^"']*)["']/g)];
  assert.ok(imports.length >= 12, "expected admin shell split module imports");
  const unversioned = imports
    .filter(([, , suffix]) => !/^\?v=\d{8}[a-z]$/.test(suffix))
    .map(([, mod]) => mod);
  assert.deepEqual(unversioned, [], `admin split imports need cache-busting: ${unversioned.join(", ")}`);
  assert.match(admin, /from\s+["']\.\/admin\/content\.js\?v=\d{8}[a-z]["']/, "blog/content tab module must be cache-busted");
});

test("rich editor imports are cache-busted from CMS entry modules", () => {
  assert.match(read("js/admin/content.js"), /from\s+["']\.\/rich-editor\.js\?v=\d{8}[a-z]["']/, "content CMS should not reuse a stale editor module");
  assert.match(read("js/admin/newsletter.js"), /from\s+["']\.\/rich-editor\.js\?v=\d{8}[a-z]["']/, "newsletter should not reuse a stale editor module");
});

test("admin modules cache-bust the shared util dependency", () => {
  const modules = [
    "js/admin.js",
    ...readdirSync(new URL("js/admin/", root))
      .filter((name) => name.endsWith(".js"))
      .map((name) => `js/admin/${name}`),
  ];
  const unversioned = modules.flatMap((path) => {
    const imports = [...read(path).matchAll(/from\s+["'](?:\.\.\/|\.\/)util\.js([^"']*)["']/g)];
    return imports
      .filter(([, suffix]) => !/^\?v=\d{8}[a-z]$/.test(suffix))
      .map(() => path);
  });
  assert.deepEqual(unversioned, [], `admin util imports need cache-busting: ${unversioned.join(", ")}`);
});

test("the deployed admin entry and its complete relative module graph share one release token", () => {
  const html = read("admin.html");
  const entry = html.match(/src=["']js\/admin\.js\?v=(\d{8}[a-z])["']/);
  assert.ok(entry, "admin.html must cache-bust the admin entrypoint");
  const release = entry[1];
  const modules = [
    "js/admin.js",
    ...readdirSync(new URL("js/admin/", root))
      .filter((name) => name.endsWith(".js"))
      .map((name) => `js/admin/${name}`),
  ];
  const mismatched = modules.flatMap((path) => {
    const imports = [...read(path).matchAll(/from\s+["'](\.\.?\/[^"']+?\.js)([^"']*)["']/g)];
    return imports
      .filter(([, , suffix]) => suffix !== `?v=${release}`)
      .map(([, target, suffix]) => `${path} -> ${target}${suffix}`);
  });
  assert.deepEqual(
    mismatched,
    [],
    `admin module graph must use release ${release}: ${mismatched.join(", ")}`,
  );
});

test("admin imports one cache-released auth URL to preserve one Supabase client", () => {
  const html = read("admin.html");
  const release = html.match(/src=["']js\/admin\.js\?v=(\d{8}[a-z])["']/)?.[1];
  assert.ok(release, "admin.html must cache-bust the admin entrypoint");
  const modules = [
    "js/admin.js",
    ...readdirSync(new URL("js/admin/", root))
      .filter((name) => name.endsWith(".js"))
      .map((name) => `js/admin/${name}`),
  ];
  const authUrls = modules.flatMap((path) => (
    [...read(path).matchAll(/from\s+["'](\.\.?\/auth\.js)([^"']*)["']/g)]
      .map(([, target, suffix]) => new URL(`${target}${suffix}`, new URL(path, root)).href)
  ));
  assert.deepEqual(
    [...new Set(authUrls)],
    [new URL(`js/auth.js?v=${release}`, root).href],
    `auth.js is a stateful singleton: ${authUrls.join(", ")}`,
  );
});
