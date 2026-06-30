import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("business panel exposes compact workflow navigation", () => {
  const html = read("dashboard.html");

  assert.match(html, /<nav class="biz-workflow-nav" aria-label="Business workflow">/);
  for (const [href, label] of [
    ["#bizCompanySetup", "Verification"],
    ["#bizInvoicing", "Invoices"],
    ["#bizPrograms", "Programs"],
    ["#bizBulk", "Bulk quotes"],
    ["#bizAccountTeam", "Account support"],
  ]) {
    assert.match(html, new RegExp(`<a href="${href}">${label}</a>`));
  }
});

test("business workflow navigation wraps without card chrome", () => {
  const html = read("dashboard.html");

  assert.match(html, /\.biz-workflow-nav \{ display: flex; flex-wrap: wrap/);
  assert.doesNotMatch(html, /class="biz-card biz-workflow-nav"/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*\.biz-workflow-nav a \{ flex: 1 1 130px; justify-content: center; \}/);
});
