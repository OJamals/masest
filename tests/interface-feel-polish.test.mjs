import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const components = read("css/components.css");
const customerChat = read("css/customer-chat.css");
const account = read("account.html");
const dashboard = read("dashboard.html");
const admin = read("admin.html");

test("interactive controls use exact, interruptible press feedback", () => {
  assert.match(
    components,
    /\.btn:active,[\s\S]*\.shop-card-quote:active\s*\{[^}]*transform:\s*scale\(\.96\)/,
    "shared public actions should use the 0.96 press scale",
  );
  assert.match(
    customerChat,
    /\.customer-chat__toggle:active\s*\{\s*transform:\s*scale\(\.96\)/,
    "the persistent support launcher should use the same press scale",
  );
  assert.match(
    account,
    /\.pw-toggle:active\s*\{[^}]*translateY\(-50%\)\s+scale\(\.96\)/,
    "the password visibility control should preserve centering while scaling",
  );
  assert.match(
    dashboard,
    /\.dash-tab:active\s*\{\s*transform:\s*scale\(\.96\)/,
    "dashboard tabs should provide tactile feedback",
  );
  assert.match(
    admin,
    /\.adm-action-item:active\s*\{\s*transform:\s*scale\(\.96\)/,
    "admin action cards should use the same press scale",
  );

  for (const [path, source] of [
    ["css/components.css", components],
    ["css/customer-chat.css", customerChat],
    ["account.html", account],
    ["dashboard.html", dashboard],
    ["admin.html", admin],
  ]) {
    assert.doesNotMatch(source, /transition(?:-property)?\s*:\s*all\b/, `${path} should never transition all properties`);
  }
});

test("photographic media has a neutral inset outline", () => {
  assert.match(
    components,
    /outline:\s*1px solid rgba\(0,\s*0,\s*0,\s*\.1\)/,
    "light media should use a pure-black ten-percent outline",
  );
  assert.match(
    components,
    /outline:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.1\)/,
    "dark story media should use a pure-white ten-percent outline",
  );
  assert.match(components, /outline-offset:\s*-1px/, "image outlines should remain inset and layout-neutral");
});

test("workspace typography, figures, and dense hit areas keep stable polish", () => {
  assert.match(account, /\.acct-title\s*\{[^}]*text-wrap:\s*balance/, "account headings should balance");
  assert.match(dashboard, /\.dash-card :where\(p, li, small\)\s*\{[^}]*text-wrap:\s*pretty/, "dashboard copy should avoid orphans");
  assert.match(admin, /\.adm-stat b,[\s\S]*font-variant-numeric:\s*tabular-nums/, "admin figures should not shift as data updates");
  assert.match(admin, /\.gbtn\s*\{[^}]*min-width:\s*40px;[^}]*min-height:\s*40px;/, "dense admin icon controls need a 40px hit area");
  assert.match(components, /\.pagination button\s*\{[^}]*min-width:\s*40px;[^}]*height:\s*40px;/, "pagination controls need a 40px hit area");
});

test("mobile support stays reachable without covering primary actions", () => {
  assert.match(
    customerChat,
    /@media \(max-width: 480px\)[\s\S]*\.customer-chat__toggle\s*\{[^}]*width:\s*52px;[^}]*padding:\s*0;/,
    "the mobile launcher should collapse to a compact icon button",
  );
  assert.match(
    customerChat,
    /@media \(max-width: 480px\)[\s\S]*\.customer-chat__toggle span\s*\{\s*display:\s*none;/,
    "the redundant visible label should be removed at narrow widths",
  );
});

test("every rendered public or operational page loads the shared component layer", () => {
  for (const path of ["services.html", "content-preview.html"]) {
    assert.match(read(path), /href="css\/components\.css(?:\?[^"]+)?"/, `${path} should load shared polish contracts`);
  }
});
