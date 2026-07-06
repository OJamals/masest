import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("business panel exposes compact workflow navigation", () => {
  const html = read("dashboard.html");

  assert.match(html, /<nav class="biz-workflow-nav" aria-label="Business workflow">/);
  // Chip labels match the card headings they scroll to; the Account-support card
  // (a duplicate of the Messages tab) was removed along with its chip.
  for (const [href, label] of [
    ["#bizCompanySetup", "Business details"],
    ["#bizInvoicing", "Business invoices"],
    ["#bizPrograms", "Service programs"],
    ["#bizBulk", "Bulk orders"],
  ]) {
    assert.match(html, new RegExp(`<a href="${href}">${label}</a>`));
  }
  assert.doesNotMatch(html, /id="bizAccountTeam"/);
});

test("business workflow navigation wraps without card chrome", () => {
  const html = read("dashboard.html");

  assert.match(html, /\.biz-workflow-nav \{ display: flex; flex-wrap: wrap/);
  assert.doesNotMatch(html, /class="biz-card biz-workflow-nav"/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*\.biz-workflow-nav a \{ flex: 1 1 130px; justify-content: center; \}/);
});
