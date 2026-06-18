import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("account/me returns buyer setup progress for dashboards", () => {
  const src = read("functions/api/account/me.js");
  const helper = read("functions/_lib/setup.js");
  assert.match(src, /buildAccountSetup/, "setup progress should be computed in one shared helper");
  assert.match(helper, /resale_cert_url/, "setup needs resale certificate state");
  assert.match(helper, /stripe_customer_id/, "setup needs payment portal state");
  assert.match(helper, /'tax'[\s\S]+?'business\.html'/, "tax setup action should point to the business setup form");
  assert.match(src, /setup:\s*buildAccountSetup\(/, "account response should include setup progress");
  for (const key of ["profile", "approval", "tax", "payment", "net_terms"]) {
    assert.match(helper, new RegExp(`'${key}'`), `missing setup step ${key}`);
  }
  assert.match(helper, /percent/, "setup should include an overall percent");
});

test("buyer dashboard renders business setup progress", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");
  assert.match(html, /id="setupBody"/, "dashboard overview needs setup body mount");
  assert.match(js, /function renderSetupProgress\(/, "dashboard should render setup progress");
  assert.match(js, /ACCOUNT\?\.setup/, "dashboard should use setup returned by account/me");
  assert.match(js, /data-setup-state/, "setup steps need non-color-only state hooks");
});

test("business hub shows the same account setup checklist", () => {
  const html = read("business.html");
  const js = read("js/business.js");
  assert.match(html, /id="bizSetup"/, "business hub needs a setup checklist mount");
  assert.match(js, /function renderSetupChecklist\(/, "business hub should render setup checklist");
  assert.match(js, /data\.setup/, "business setup should use account/me setup data");
});

test("account company setup endpoint lets buyers update tax setup fields", () => {
  const endpoint = new URL("functions/api/account/company.js", root);
  assert.equal(existsSync(endpoint), true, "account company setup endpoint should exist");
  const src = readFileSync(endpoint, "utf8");

  assert.match(src, /companyForUser/, "endpoint must scope updates to caller company");
  assert.match(src, /resale_cert_url/, "endpoint should update resale certificate URL");
  assert.match(src, /tax_exempt/, "endpoint should update tax-exempt status");
  assert.match(src, /body\.tax_exempt !== undefined/, "endpoint should only update tax_exempt when submitted");
  assert.match(src, /invalid_resale_cert_url/, "endpoint should reject invalid resale certificate URLs");
  assert.match(src, /\.eq\('id', companyId\)/, "company update must be id-scoped");
});

test("business hub renders and submits company setup form", () => {
  const html = read("business.html");
  const js = read("js/business.js");

  assert.match(html, /id="bizCompanySetup"/, "business hub should mount company setup form");
  assert.match(js, /function renderCompanySetupForm\(/, "business hub should render company setup form");
  assert.match(js, /id="companySetupForm"/, "company setup form should have a stable id");
  assert.match(js, /\/api\/account\/company/, "company setup form should submit to account company endpoint");
  assert.match(js, /tax_exempt/, "company setup form should include tax-exempt control");
});

test("shared setup helper is used by account and admin setup surfaces", () => {
  const helper = read("functions/_lib/setup.js");
  const account = read("functions/api/account/me.js");
  const adminCompany = read("functions/api/admin/company.js");
  const adminCompanies = read("functions/api/admin/companies.js");
  const adminStats = read("functions/api/admin/stats.js");

  assert.match(helper, /export function buildAccountSetup\(/, "shared helper should build buyer setup");
  assert.match(helper, /export function buildCompanySetup\(/, "shared helper should build admin setup");
  assert.match(helper, /export function setupStepBreakdown\(/, "shared helper should build admin breakdown rows");
  assert.match(account, /import .*buildAccountSetup.*_lib\/setup\.js/, "account/me should import shared setup helper");
  assert.match(adminCompany, /import .*buildCompanySetup.*_lib\/setup\.js/, "admin company detail should import shared setup helper");
  assert.match(adminCompanies, /import .*buildCompanySetup.*_lib\/setup\.js/, "admin company list should import shared setup helper");
  assert.match(adminStats, /import .*buildCompanySetup.*setupStepBreakdown.*_lib\/setup\.js/, "admin stats should import shared setup helpers");
});

test("business hub exposes Stripe payment setup portal", () => {
  const js = read("js/business.js");

  assert.match(js, /function renderPaymentSetup\(/, "business hub should render payment setup action");
  assert.match(js, /\/api\/account\/billing-portal/, "business hub should open billing portal endpoint");
  assert.match(js, /window\.location\.assign/, "business hub should redirect to Stripe portal URL");
  assert.match(js, /stripe_not_configured/, "business hub should show Stripe setup errors clearly");
});
