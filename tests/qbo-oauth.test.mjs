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

test("QBO connect key can supply the OAuth URL inputs", async () => {
  const { makeQboState, qboAuthorizationUrl } = await import("../functions/_lib/qbo-oauth.js");
  const env = {
    QBO_CONNECT_KEY: JSON.stringify({
      client_id: "qbo-client-id",
      client_secret: "qbo-client-secret",
      redirect_uri: "https://masest.co/api/admin/qbo/callback",
      oauth_state_secret: "oauth-state-secret",
      sync_secret: "sync-secret",
      income_account_id: "79",
      environment: "production",
    }),
  };
  const request = new Request("https://masest.co/api/admin/qbo/connect");
  const state = await makeQboState(env, Date.parse("2026-06-30T12:00:00Z"));
  const url = new URL(qboAuthorizationUrl(request, env, state));

  assert.equal(url.searchParams.get("client_id"), "qbo-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://masest.co/api/admin/qbo/callback");
  assert.equal(url.searchParams.get("state"), state);
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
  assert.match(src, /qbo_sync_status/);
  assert.match(src, /sync_counts/);
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
  assert.match(qbo, /sync_counts/);
  assert.match(qbo, /qboSyncSummary/);
});
test("admin QuickBooks panel exposes a staff-triggered manual sync", () => {
  const html = read("admin.html");
  const qbo = read("js/admin/qbo.js");
  assert.match(html, /qboSyncNow/, "admin overview should include a manual QBO sync button");
  assert.match(html, /qboSyncStatus/, "admin overview should include sync result status text");
  assert.match(qbo, /export async function runQboSync\(/,
    "admin QBO module should export the manual sync handler");
  assert.match(qbo, /\/api\/admin\/qbo\/sync/,
    "manual sync should call the staff-gated admin sync endpoint");
});

test("admin QBO sync endpoint is staff-gated and delegates to the worker", () => {
  const src = read("functions/api/admin/qbo/sync.js");
  assert.match(src, /requireStaff\(/, "manual QBO sync endpoint must require staff");
  assert.match(src, /runQboSync\(/, "manual endpoint must reuse the QBO worker");
  assert.match(src, /json\(401,\s*\{\s*error:\s*'unauthenticated'/,
    "manual endpoint must reject unauthenticated callers");
  assert.match(src, /json\(403,\s*\{\s*error:\s*'forbidden'/,
    "manual endpoint must reject non-staff callers");
});
