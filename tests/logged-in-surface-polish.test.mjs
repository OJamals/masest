import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("business hub avoids blank setup cards and cramped inline forms", () => {
  const html = read("business.html");
  const js = read("js/business.js");

  assert.match(js, /bizSetup'\)\.hidden\s*=\s*true/, "empty setup state should hide setup card");
  assert.match(html, /class="biz-layout"/, "business hub should use the same sidebar app shell as dashboards");
  assert.match(html, /class="biz-sidebar"/, "business hub should expose a compact section rail");
  assert.match(html, /class="biz-inline-form"/, "business forms need reusable inline form layout");
  assert.doesNotMatch(html, /style="/, "business hub should not rely on inline style polish");
  assert.match(html, /tier-grid/, "program tier layout should remain explicit and responsive");
});

test("admin dashboard has production shell affordances without inline layout hacks", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");

  assert.match(html, /adm-tabs-wrap/, "admin tab rail should keep its mobile-safe scroll container class");
  assert.match(html, /class="adm-layout"/, "admin app should use a dashboard-style two-column shell");
  assert.match(html, /class="adm-sidebar adm-tabs-wrap"/, "admin sections should live in a sidebar rail");
  assert.match(html, /class="adm-nav-group"[\s\S]*<span>Operations<\/span>/, "admin nav should group operational sections");
  assert.match(html, /adm-panel-header/, "admin panels should expose consistent panel header utility");
  assert.match(html, /adm-inline-actions/, "admin inline action rows should use reusable classes");
  assert.doesNotMatch(html, /style="/, "admin shell should not rely on inline style polish");
  assert.match(js, /SEO audit[\s\S]*adm-table-wrap/, "admin SEO audit table should render in the scroll-safe table wrapper");
});

test("dashboard panels protect form and notification text from clipping", () => {
  const html = read("dashboard.html");

  assert.match(html, /\.dash-card \.field-grid/, "dashboard forms should override public-page field grid widths");
  assert.match(html, /\.notif-body > \*/, "notification content should wrap inside card width");
  assert.doesNotMatch(html, /\.notif\.unread\s*\{[^}]*margin:\s*0\s+-/, "unread notifications should not use negative margins inside cards");
});
