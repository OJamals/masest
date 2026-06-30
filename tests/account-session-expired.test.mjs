import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("account seeds a notice when bounced here on session expiry (?expired=1)", () => {
  const account = read("account.html");
  const dashboard = read("js/dashboard.js");

  // The dashboard redirects here with ?expired=1 when a session lapses.
  assert.match(dashboard, /account\.html\?expired=1&return=/);

  // account.html must read ?expired=1 and seed a message on the login status line.
  assert.match(account, /function handleExpiredParam/);
  assert.match(account, /params\.get\("expired"\) !== "1"/);
  assert.match(account, /setStatus\(\$\("liStatus"\), "Your session expired/);

  // It must run before the login flow boots, and clear the param without losing ?return=.
  assert.match(account, /handleExpiredParam\(\);\s*\n\s*handleAuthRedirect\(\);/);
  assert.match(account, /params\.delete\("expired"\)/);
});
