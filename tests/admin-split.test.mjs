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

test("admin QuickBooks panel renders failed sync retry controls", () => {
  const html = read("admin.html");
  const qbo = read("js/admin/qbo.js");
  assert.match(html, /qboFailedOrders/);
  assert.match(qbo, /qbo_failed_orders/);
  assert.match(qbo, /data-qbo-retry/);
  assert.match(qbo, /\/api\/admin\/qbo\/retry/);
});
