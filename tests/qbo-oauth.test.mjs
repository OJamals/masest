import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QBO connect endpoint is staff-gated and builds Intuit consent URLs", () => {
  const src = read("functions/api/admin/qbo/connect.js");
  const helper = read("functions/_lib/qbo-oauth.js");
  assert.match(src, /requireStaff/);
  assert.match(helper, /appcenter\.intuit\.com\/connect\/oauth2/);
  assert.match(helper, /com\.intuit\.quickbooks\.accounting/);
  assert.match(helper, /QBO_REDIRECT_URI/);
  assert.match(src, /format'\)\s*===\s*'json'/);
  assert.match(src, /status:\s*302/);
});

test("QBO callback verifies staff-issued state and stores OAuth tokens", () => {
  const src = read("functions/api/admin/qbo/callback.js");
  const helper = read("functions/_lib/qbo-oauth.js");
  assert.match(src, /verifyQboState/);
  assert.match(helper, /grant_type['"]?\s*,\s*['"]authorization_code/);
  assert.match(helper, /oauth\.platform\.intuit\.com\/oauth2\/v1\/tokens\/bearer/);
  assert.match(src, /qbo_tokens/);
  assert.match(src, /realm_id:\s*realmId/);
  assert.match(src, /refresh_token/);
});

test("QBO status endpoint is staff-gated and reports connected state", () => {
  const src = read("functions/api/admin/qbo/status.js");
  assert.match(src, /requireStaff/);
  assert.match(src, /qbo_tokens/);
  assert.match(src, /connected/);
});

test("admin UI exposes QuickBooks connect status and action", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");
  const qbo = read("js/admin/qbo.js");
  assert.match(html, /qboStatus/);
  assert.match(html, /qboConnect/);
  assert.match(js, /renderQboStatus/);
  assert.match(qbo, /\/api\/admin\/qbo\/status/);
  assert.match(qbo, /\/api\/admin\/qbo\/connect\?format=json/);
});
