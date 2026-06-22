import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("shared chrome uses a replaceable auth placeholder", () => {
  const chrome = read("js/main/chrome.js");

  assert.match(chrome, /class="[^"]*nav-auth-placeholder[^"]*"/, "chrome should render a replaceable auth placeholder");
  assert.doesNotMatch(
    chrome,
    /class="nav-account"\s+href="\$\{root\}account\.html"/,
    "static Sign in link must not use nav-account because that blocks the real account control",
  );
});

test("account nav replaces the placeholder and exposes business plus account sections", () => {
  const nav = read("js/account-nav.js");

  // Must match BOTH the SSR placeholder (.nav-auth-placeholder) and a prior-rendered control
  // (.nav-account); matching only one leaves the other behind → "Sign in" + account control both show.
  assert.match(nav, /querySelector\(['"]\.nav-account,\s*\.nav-auth-placeholder['"]\)/, "account nav must find the placeholder or the existing control");
  assert.match(nav, /replaceWith\(mount\)/, "account nav should replace the placeholder instead of adding a second control");
  assert.match(nav, /Dashboard/, "signed-in nav should link to dashboard");
  assert.match(nav, /Business/, "signed-in nav should link to business tools");
  assert.match(nav, /Profile/, "account section should include profile");
  assert.match(nav, /Security/, "account section should include security");
  assert.match(nav, /Addresses/, "account section should include addresses");
  assert.match(nav, /Payment methods/, "account section should include payment methods");
});

test("account nav re-renders on auth change so the header swaps Sign in after login", () => {
  const nav = read("js/account-nav.js");
  const auth = read("js/auth.js");

  // The control is built once at load; without an auth-change listener an in-page login
  // (no reload) leaves a stale "Sign in" button in the header.
  assert.match(nav, /addEventListener\(['"]masest:auth['"]/, "account nav must re-render on the masest:auth event");
  assert.match(auth, /function emitAuth/, "auth helper should broadcast auth-state changes");
  assert.match(auth, /new CustomEvent\(['"]masest:auth['"]\)/, "auth helper should dispatch the masest:auth event");
  // login + logout must broadcast so both directions refresh the header.
  assert.match(auth, /emitAuth\(\);\s*\n\s*return data;/, "login should emit an auth change");
  assert.match(auth, /signOut\(\);\s*\n\s*emitAuth\(\);/, "logout should emit an auth change");
});

test("dashboard organizes signed-in tools with a sidebar and account group", () => {
  const dashboard = read("dashboard.html");

  assert.match(dashboard, /class="dash-sidebar"/, "dashboard should use a sidebar nav for signed-in tools");
  assert.match(dashboard, /class="dash-nav-group"[^>]*>\s*<span>Account<\/span>/s, "account tools should be grouped together");
  assert.match(dashboard, /data-tab="security"/, "security should be a first-class account panel");
  assert.match(dashboard, /ph-fingerprint/, "security should use a less generic account identity icon");
  assert.match(dashboard, /class="dash-section-title"/, "dashboard panel headings should use reusable classes instead of inline style");
});

test("logged-in dashboard admin tabs sync with hash changes", () => {
 const dashboard = read("js/dashboard.js");
 const admin = read("js/admin.js");

 assert.match(dashboard, /addEventListener\(['"]hashchange['"]/,
 "dashboard should respond to same-page #tab navigation and browser back/forward");
 assert.match(admin, /addEventListener\(['"]hashchange['"]/,
 "admin should respond to same-page #tab navigation and browser back/forward");
});

test("account dropdown section labels are styled in the shared account nav", () => {
  const nav = read("js/account-nav.js");

  assert.match(nav, /\.acct-menu-section/, "account dropdown grouped sections need explicit styling");
  assert.match(nav, /\.acct-menu-label/, "account dropdown labels need explicit styling");
});

test("account dropdown identifies notification badge source", () => {
  const nav = read("js/account-nav.js");

  assert.match(nav, /data-account-nav-notifications/, "notification menu row should be targetable for unread source count");
  assert.match(nav, /\.acct-menu-count/, "dropdown should style per-row unread counts");
  assert.match(nav, /notifLink\??\.querySelector\(['"]\.acct-menu-count['"]\)/, "unread fetch should update the Notifications row count");
});

test("account dropdown is viewport clamped for left edge buttons", () => {
  const nav = read("js/account-nav.js");

  assert.match(nav, /\.acct-dd-menu\s*\{[^}]*position:fixed/s, "dropdown menu should escape edge-clipping with fixed positioning");
  assert.match(nav, /function positionAccountMenu/, "account nav should position dropdown relative to trigger");
  assert.match(nav, /Math\.max\(8,\s*Math\.min/, "account dropdown should clamp within viewport gutters");
});
