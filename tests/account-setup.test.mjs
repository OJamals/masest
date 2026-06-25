import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("account/me returns buyer setup progress for dashboards", () => {
  const src = read("functions/api/account/me.js");
  const helper = read("functions/_lib/setup.js");
  assert.match(src, /buildAccountSetup/, "setup progress should be computed in one shared helper");
  assert.match(src, /if \(profile\.company_id\)/, "account-only profiles should not query a null company id");
  assert.match(helper, /resale_cert_url/, "setup needs resale certificate state");
  assert.match(helper, /stripe_customer_id/, "setup needs payment portal state");
  assert.match(helper, /'tax'[\s\S]+?'dashboard\.html#business'/, "tax setup action should point to the dashboard business setup form");
  assert.match(src, /setup:\s*buildAccountSetup\(/, "account response should include setup progress");
  for (const key of ["profile", "approval", "tax", "payment", "net_terms"]) {
    assert.match(helper, new RegExp(`'${key}'`), `missing setup step ${key}`);
  }
  assert.match(helper, /percent/, "setup should include an overall percent");
});

test("registration allows user accounts before business approval", () => {
  const endpoint = read("functions/api/account/register.js");
  const account = read("account.html");

  assert.match(endpoint, /account_ready:\s*true/, "registration should mark the user account ready immediately");
  assert.match(endpoint, /needs_business:\s*true/, "company-free registration should tell the client business setup is still open");
  assert.match(endpoint, /company_id:\s*null/, "company-free registration should create a profile without a company");
  assert.match(endpoint, /business_pending_approval:\s*true/, "creating a company should start business approval separately");
  assert.doesNotMatch(endpoint, /if \(!company\.name/, "company name should not be mandatory for user registration");
  assert.match(account, /<label for="rCompany">Company<\/label>/, "company should be optional in the registration form");
  assert.doesNotMatch(account, /id="rCompany"[^>]+required/, "registration form should not require a company");
});

test("buyer dashboard renders business setup progress", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");
  assert.match(html, /id="setupBody"/, "dashboard overview needs setup body mount");
  assert.match(js, /function renderSetupProgress\(/, "dashboard should render setup progress");
  assert.match(js, /ACCOUNT\?\.setup/, "dashboard should use setup returned by account/me");
  assert.match(js, /data-setup-state/, "setup steps need non-color-only state hooks");
});

test("dashboard business panel shows the same account setup checklist", () => {
  const html = read("dashboard.html");
  const js = read("js/business.js");
  assert.match(html, /id="bizSetup"/, "business hub needs a setup checklist mount");
  assert.match(js, /function renderSetupChecklist\(/, "business hub should render setup checklist");
  assert.match(js, /data\.setup/, "business setup should use account/me setup data");
  assert.match(html, /data-tab="business"/, "dashboard should expose business as a first-class panel");
});

test("account company setup endpoint lets buyers update tax setup fields", () => {
  const endpoint = new URL("functions/api/account/company.js", root);
  assert.equal(existsSync(endpoint), true, "account company setup endpoint should exist");
  const src = readFileSync(endpoint, "utf8");

  assert.match(src, /userFromRequest/, "endpoint must authenticate the caller");
  assert.match(src, /\.select\('id,company_id,role'\)/, "endpoint should read the caller profile before company writes");
  assert.match(src, /status:\s*'pending'/, "new business profiles must start pending admin approval");
  assert.match(src, /company_name_required/, "creating a business should require a company name");
  assert.match(src, /\.update\(\{ company_id: company\.id, role: 'admin' \}\)/, "business creator should become company admin");
  assert.match(src, /resale_cert_url/, "endpoint should update resale certificate URL");
  assert.match(src, /tax_exempt/, "endpoint should update tax-exempt status");
  assert.match(src, /body\.tax_exempt !== undefined/, "endpoint should only update tax_exempt when submitted");
  assert.match(src, /invalid_resale_cert_url/, "endpoint should reject invalid resale certificate URLs");
  assert.match(src, /\.eq\('id', profile\.company_id\)/, "company update must be id-scoped");
  // Auth result must be handled safely: via the requireCompany wrapper, or by
  // destructuring { user } from userFromRequest (never assigning the wrapper to user).
  const usesWrapper = /const\s+ctx\s*=\s*await\s+requireCompany\(/.test(src);
  const destructuresUser = /const\s*\{\s*[^}]*\buser\b[^}]*\}\s*=\s*await\s+(requireCompany|userFromRequest)\(/.test(src)
    || /const\s*\{[^}]*\buser\b[^}]*\}\s*=\s*ctx\b/.test(src);
  assert.doesNotMatch(src, /\bconst\s+user\s*=\s*await\s+userFromRequest\b/,
    "endpoint must not assign the userFromRequest wrapper directly to user");
  assert.ok(usesWrapper || destructuresUser,
    "endpoint must resolve auth via requireCompany or destructured userFromRequest");
});

test("dashboard business panel renders and submits company setup form", () => {
  const html = read("dashboard.html");
  const js = read("js/business.js");

  assert.match(html, /id="bizCompanySetup"/, "business hub should mount company setup form");
  assert.match(js, /function renderCompanySetupForm\(/, "business hub should render company setup form");
  assert.match(js, /id="companySetupForm"/, "company setup form should have a stable id");
  assert.match(js, /id="companyName"/, "business hub should let account-only users create a company profile");
  assert.match(js, /Submit for approval/, "company creation should be framed as an approval request");
  assert.match(js, /\/api\/account\/company/, "company setup form should submit to account company endpoint");
  assert.match(js, /tax_exempt/, "company setup form should include tax-exempt control");
});

test("embedded business panel renders guest and needs-profile states safely", () => {
  const html = read("dashboard.html");
  const js = read("js/business.js");

  assert.match(html, /id="bizGuest" hidden/, "dashboard business panel needs an embedded guest mount");
  assert.match(js, /function showBusinessGuest\(/, "business module should render guest copy for embedded mounts");
  assert.match(js, /data\.needs_profile[\s\S]+showBusinessGuest/, "needs-profile accounts should not assume legacy guest children exist");
  assert.match(js, /account\.html\?return=dashboard\.html%23business/, "embedded sign-in links should preserve the dashboard hash in the return query");
  assert.doesNotMatch(js, /querySelector\('p'\)\.textContent = 'Your email is confirmed/, "needs-profile branch must not dereference missing embedded children directly");
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
  assert.match(js, /Payment setup unlocks after business approval/, "payment setup should be locked before business approval");
  assert.match(js, /sendReservedTab\(portalTab, out\.url\)/, "business hub should open the Stripe portal without replacing the hub tab");
  assert.match(js, /stripe_not_configured/, "business hub should show Stripe setup errors clearly");
});

test("legacy business page forwards to the dashboard business panel", () => {
  const html = read("business.html");

  assert.match(html, /dashboard\.html\$\{params\}\$\{targetHash\}/, "legacy business URL should preserve query strings and forward into dashboard");
  assert.match(html, /#bizProfile[\s\S]+#bizPrograms[\s\S]+#bizBulk/, "legacy business section hashes should map to the dashboard business tab");
  assert.match(html, /dashboard\.html#business/, "no-JS fallback should point to the dashboard business panel");
});
test("setup helper uses Stripe-specific payment setup copy", () => {
  const helper = read("functions/_lib/setup.js");
  assert.match(helper, /Open the secure Stripe portal after approval/, "buyer setup should name Stripe portal");
  assert.match(helper, /No saved Stripe portal customer/, "admin setup should name Stripe portal");
});
