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
