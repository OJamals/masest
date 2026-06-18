import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin companies API returns setup progress for every company", () => {
  const src = read("functions/api/admin/companies.js");
  assert.match(src, /function buildCompanySetup\(/, "setup progress should be computed by a helper");
  assert.match(src, /\.map\(\(company\) => \(\{ \.\.\.company, setup: buildCompanySetup\(company\) \}\)\)/,
    "GET response should attach setup to each company");
  for (const key of ["profile", "approval", "tax", "payment", "net_terms"]) {
    assert.match(src, new RegExp(`key:\\s*'${key}'`), `missing setup step ${key}`);
  }
  assert.match(src, /percent/, "admin setup should include percent complete");
});

test("admin companies table exposes setup progress and open gaps", () => {
  const src = read("js/admin.js");
  assert.match(src, /function setupProgress\(/, "admin UI should format company setup progress");
  assert.match(src, /<th>Setup<\/th>/, "companies table should include a setup column");
  assert.match(src, /data-setup-state/, "open setup gaps should have non-color-only state");
  assert.match(src, /company\.setup/, "admin company rows should use API setup data");
});

test("admin company detail exposes setup and has a working detail panel", () => {
  const endpoint = read("functions/api/admin/company.js");
  const html = read("admin.html");
  const js = read("js/admin.js");
  assert.match(endpoint, /setup:\s*buildCompanySetup\(/,
    "single-company endpoint should return setup progress");
  assert.match(html, /id="companyDetail"/,
    "admin companies section should include a detail mount");
  assert.match(js, /async function openCompanyDetail\(/,
    "admin UI should fetch and render company details");
  assert.match(js, /\/api\/admin\/company\?id=/,
    "detail renderer should call the single-company endpoint");
  assert.match(js, /\[data-open-company\]/,
    "company name buttons should be wired to open details");
  assert.match(js, /setupProgress\(detail\.company\)/,
    "detail panel should reuse setup progress");
});

test("admin overview reports account setup follow-ups", () => {
  const stats = read("functions/api/admin/stats.js");
  const js = read("js/admin.js");
  assert.match(stats, /setup_followups/,
    "admin stats should include account setup follow-up summary");
  assert.match(stats, /buildCompanySetup\(/,
    "stats should use the same setup rules as account lists");
  assert.match(stats, /open_steps/,
    "stats should expose open setup step counts");
  assert.match(js, /stats\.setup_followups/,
    "overview should render setup follow-ups");
  assert.match(js, /Setup follow-ups/,
    "overview card should label setup follow-ups clearly");
});
