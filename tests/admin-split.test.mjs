import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createFeatureLoader } from "../js/admin/feature-loader.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const moduleSpecifiers = (source) => [
  ...source.matchAll(/from\s+["']([^"']+?\.js)([^"']*)["']/g),
  ...source.matchAll(/import\s*\(\s*["']([^"']+?\.js)([^"']*)["']\s*\)/g),
];

test("admin entrypoint lazy-loads QuickBooks controls from a split module", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /import\s*\(\s*["']\.\/admin\/qbo\.js\?v=\d{8}[a-z]["']\s*\)/);
  assert.doesNotMatch(admin, /from\s+["']\.\/admin\/qbo\.js/);
  assert.doesNotMatch(admin, /async function renderQboStatus\s*\(/);
  assert.doesNotMatch(admin, /async function connectQbo\s*\(/);

  const qbo = read("js/admin/qbo.js");
  assert.match(qbo, /export async function renderQboStatus\b/);
  assert.match(qbo, /export async function connectQbo\b/);
  assert.match(qbo, /\/api\/admin\/qbo\/status/);
  assert.match(qbo, /\/api\/admin\/qbo\/connect\?format=json/);
});

test("admin entrypoint lazy-loads and wires workspace module groups", () => {
  const admin = read("js/admin.js");
  const modules = [
    { mod: "traffic", factory: "createTrafficRenderer", inline: /function renderTrafficFunnel\s*\(/ },
    { mod: "seo", factory: "createSeoAudit", inline: /async function runSeoAudit\s*\(/ },
    { mod: "qbo", factory: "renderQboStatus", inline: /async function renderQboStatus\s*\(/ },
    { mod: "threads", factory: "createThreadsTab", inline: /async function renderThreads\s*\(/ },
    { mod: "offers", factory: "createOffersTab", inline: /async function renderOffers\s*\(/ },
    { mod: "crm-workspace", factory: "createCrmWorkspace", inline: /async function renderCrm\s*\(/ },
    { mod: "crm", factory: "createCrmPanel", inline: /function renderTimeline\s*\(/ },
    { mod: "products", factory: "createProductsTab", inline: /async function renderProducts\s*\(/ },
    { mod: "pricing", factory: "createPricingTab", inline: /async function renderPricing\s*\(/ },
    { mod: "inventory", factory: "createInventoryCard", inline: /async function renderLowStock\s*\(/ },
    { mod: "coupons", factory: "createCouponsCard", inline: /async function renderCoupons\s*\(/ },
    { mod: "content", factory: "createContentTab", inline: /async function renderContent\s*\(/ },
    { mod: "companies", factory: "createCompaniesTab", inline: /async function renderCompanies\s*\(/ },
    { mod: "orders", factory: "createOrdersTab", inline: /async function renderOrders\s*\(/ },
    { mod: "quotes", factory: "createQuotesTab", inline: /async function renderQuotePipeline\s*\(/ },
    { mod: "reviews", factory: "createReviewsTab", inline: /async function renderReviews\s*\(/ },
    { mod: "newsletter", factory: "createNewsletterTab", inline: /async function renderNewsletter\s*\(/ },
  ];
  for (const { mod, factory, inline } of modules) {
    assert.match(admin, new RegExp(`import\\s*\\(\\s*["']\\./admin/${mod}\\.js\\?v=\\d{8}[a-z]["']\\s*\\)`), `admin should lazy-load ./admin/${mod}.js`);
    assert.doesNotMatch(admin, new RegExp(`from\\s+["']\\./admin/${mod}\\.js`), `admin should not eagerly import ./admin/${mod}.js`);
    assert.match(admin, new RegExp(`${factory}\\b`), `admin should construct ${factory}`);
    assert.doesNotMatch(admin, inline, `${mod} renderer should not be defined inline in admin.js`);
  }
  assert.match(admin, /createFeatureLoader\s*\(/);
  assert.match(admin, /const\s+FEATURE_GROUP_BY_TAB\s*=/);
  assert.match(admin, /renderToken/);
  assert.match(admin, /data-feature-load-error/);
});

test("feature loader caches construction and normalizes wire/render once", async () => {
  let constructed = 0;
  let wired = 0;
  let rendered = 0;
  const loader = createFeatureLoader({
    orders: async () => {
      constructed += 1;
      return {
        wire: () => { wired += 1; },
        render: () => { rendered += 1; return "orders"; },
      };
    },
  });

  const [first, concurrent] = await Promise.all([loader.load("orders"), loader.load("orders")]);
  assert.equal(first, concurrent);
  assert.equal(constructed, 1);
  await Promise.all([first.wire(), concurrent.wire(), first.wire()]);
  assert.equal(wired, 1);
  assert.equal(await first.render(), "orders");
  assert.equal(rendered, 1);
});

test("feature loader evicts failed construction so the same group can retry", async () => {
  let attempts = 0;
  const loader = createFeatureLoader({
    quotes: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("module_unavailable");
      return { render: () => "recovered", wire: () => {} };
    },
  });

  await assert.rejects(loader.load("quotes"), /module_unavailable/);
  const recovered = await loader.load("quotes");
  assert.equal(await recovered.render(), "recovered");
  assert.equal(attempts, 2);
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
  const imports = moduleSpecifiers(admin)
    .filter(([, target]) => target.startsWith("./admin/"));
  assert.ok(imports.length >= 18, "expected admin shell and lazy feature module imports");
  const unversioned = imports
    .filter(([, , suffix]) => !/^\?v=\d{8}[a-z]$/.test(suffix))
    .map(([, mod]) => mod);
  assert.deepEqual(unversioned, [], `admin split imports need cache-busting: ${unversioned.join(", ")}`);
  assert.match(admin, /import\s*\(\s*["']\.\/admin\/content\.js\?v=\d{8}[a-z]["']\s*\)/, "blog/content tab module must be cache-busted");
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
    const imports = moduleSpecifiers(read(path))
      .filter(([, target]) => target.startsWith("./") || target.startsWith("../"));
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
