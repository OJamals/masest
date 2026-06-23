import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin entrypoint imports QuickBooks controls from a split module", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /from\s+["']\.\/admin\/qbo\.js["']/);
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
  ];
  for (const { mod, factory, inline } of tabs) {
    assert.match(admin, new RegExp(`from\\s+["']\\./admin/${mod}\\.js["']`), `admin should import ./admin/${mod}.js`);
    assert.match(admin, new RegExp(`${factory}\\(`), `admin should wire ${factory}`);
    assert.doesNotMatch(admin, inline, `${mod} renderer should not be defined inline in admin.js`);
  }
});

test("admin QuickBooks panel renders failed sync retry controls", () => {
  const html = read("admin.html");
  const qbo = read("js/admin/qbo.js");
  assert.match(html, /qboFailedOrders/);
  assert.match(qbo, /qbo_failed_orders/);
  assert.match(qbo, /data-qbo-retry/);
  assert.match(qbo, /\/api\/admin\/qbo\/retry/);
});
