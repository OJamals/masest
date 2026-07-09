import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin Accounts defaults to a user-first management console", () => {
  const html = read("admin.html");
  const js = read("js/admin/companies.js");

  assert.match(html, /data-acct-view="users"[^>]*aria-pressed="true"[^>]*>Users</,
    "Accounts should open on a Users view, not a company approval list");
  assert.doesNotMatch(html, /id="admAcctUsers"[^>]*hidden/,
    "the registered-user directory should be visible by default");
  assert.match(html, /data-acct-panel="companies"[^>]*hidden/,
    "business approval queue should be secondary by default");

  assert.match(js, /function accountMetrics\(/,
    "user console should summarize total users, pending businesses, companyless users, and staff");
  assert.match(js, /data-account-filter/,
    "user console should have stable filters for common account states");
  assert.match(js, /data-au-business-status/,
    "user rows should expose associated business approval state");
  assert.match(js, /async function openAccountUserDetail\(/,
    "Manage should open a user-centered detail drawer");
  assert.match(js, /\/api\/admin\/users\?detail=/,
    "user detail drawer should use the per-user console endpoint");
});

test("admin Accounts exposes business lifecycle controls from the user console", () => {
  const js = read("js/admin/companies.js");
  const api = read("functions/api/admin/companies.js");

  assert.match(js, /data-business-new/,
    "Accounts should provide a direct New business control");
  assert.match(js, /data-business-edit/,
    "business detail controls should support editing company metadata");
  assert.match(js, /data-business-delete/,
    "business detail controls should support removing unused companies");
  assert.match(js, /create_company/,
    "UI should call the company creation action");
  assert.match(js, /update_company/,
    "UI should call the company update action");
  assert.match(js, /action:\s*'delete_company'/,
    "UI should call the company delete action");

  assert.match(api, /action === 'create_company'/,
    "companies endpoint should create businesses");
  assert.match(api, /action === 'update_company'/,
    "companies endpoint should edit business metadata");
  assert.match(api, /action === 'delete_company'/,
    "companies endpoint should delete businesses");
  assert.match(api, /company\.create/,
    "company creation should be audited");
  assert.match(api, /company\.update/,
    "company updates should be audited");
  assert.match(api, /company\.delete/,
    "company deletion should be audited");
});
