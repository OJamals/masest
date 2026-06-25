import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin companies API returns setup progress for every company", () => {
  const src = read("functions/api/admin/companies.js");
  const helper = read("functions/_lib/setup.js");
  assert.match(src, /import .*buildCompanySetup.*_lib\/setup\.js/, "setup progress should come from the shared helper");
  assert.match(src, /\.map\(\(company\) => \(\{ \.\.\.company, setup: buildCompanySetup\(company\) \}\)\)/,
    "GET response should attach setup to each company");
  for (const key of ["profile", "approval", "tax", "payment", "net_terms"]) {
    assert.match(helper, new RegExp(`'${key}'`), `missing setup step ${key}`);
  }
  assert.match(helper, /percent/, "admin setup should include percent complete");
});

test("admin companies list exposes setup progress and open gaps", () => {
  // Companies tab (incl. setupProgress) moved into its own module in #36.
  const src = read("js/admin/companies.js");
  assert.match(src, /function setupProgress\(/, "admin UI should format company setup progress");
  assert.match(src, /<span>Setup<\/span>\$\{setupProgress\(company\)\}/, "companies list should include a setup field");
  assert.match(src, /company-admin-list/, "companies should render in a responsive admin list");
  assert.match(src, /data-setup-state/, "open setup gaps should have non-color-only state");
  assert.match(src, /company\.setup/, "admin company rows should use API setup data");
});

test("admin company detail exposes setup and has a working detail panel", () => {
  const endpoint = read("functions/api/admin/company.js");
  const html = read("admin.html");
  // The company-detail drawer (openCompanyDetail) moved into the companies module in #36.
  const js = read("js/admin/companies.js");
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

test("admin overview renders labeled setup-step follow-up breakdown", () => {
  const stats = read("functions/api/admin/stats.js");
  const helper = read("functions/_lib/setup.js");
  const js = read("js/admin.js");

  assert.match(helper, /SETUP_STEP_LABELS/,
    "stats should keep a label map for setup steps");
  assert.match(helper, /setupStepBreakdown\(/,
    "stats should convert raw open-step counts into labeled rows");
  assert.match(js, /function renderSetupFollowups\(/,
    "overview should have a dedicated setup follow-up renderer");
  assert.match(js, /data-setup-followups/,
    "overview should render a stable setup follow-up breakdown container");
  assert.match(js, /No setup gaps/,
    "overview should render an empty state for clean account setup");
});
