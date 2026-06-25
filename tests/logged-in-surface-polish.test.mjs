import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard business panel avoids blank setup cards and cramped inline forms", () => {
  const html = read("dashboard.html");
  const js = read("js/business.js");
  const businessPanel = html.match(/<div class="dash-panel" data-panel="business"[\s\S]*?<div class="dash-panel" data-panel="addresses"/)?.[0] || "";

  assert.match(js, /bizSetup'\)\.hidden\s*=\s*true/, "empty setup state should hide setup card");
  assert.match(html, /data-tab="business"/, "business tools should live in the dashboard sidebar");
  assert.match(html, /class="biz-inline-form"/, "business forms need reusable inline form layout");
  assert.doesNotMatch(businessPanel, /style="/, "business panel should not rely on inline style polish");
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
  assert.match(js, /from\s+["']\.\/admin\/seo\.js["']/, "admin should import the split SEO-audit module");
  const seo = read("js/admin/seo.js"); // SEO-audit tab extracted in #36 split
  assert.match(seo, /SEO audit[\s\S]*adm-table-wrap/, "admin SEO audit table should render in the scroll-safe table wrapper");
});

test("dashboard panels protect form and notification text from clipping", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");

  assert.match(html, /\.dash-card \.field-grid/, "dashboard forms should override public-page field grid widths");
  assert.match(html, /\.notif-body > \*/, "notification content should wrap inside card width");
  assert.match(html, /\.notif-prefs\s*\{[^}]*display:\s*flex/, "notification preferences should use a reusable layout class");
  assert.match(html, /class="notif-pref-label"/, "notification preference labels should use reusable classes");
  assert.match(html, /\.dash-pager/, "dashboard pagers should use reusable spacing classes");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-sidebar \.dash-tabs\s*\{[^}]*flex-wrap:\s*nowrap/, "mobile dashboard nav should stay a single horizontal rail");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-nav-group\s*\{\s*display:\s*contents;\s*\}/, "mobile dashboard nav should flatten grouped sections");
  assert.doesNotMatch(html, /\.notif\.unread\s*\{[^}]*margin:\s*0\s+-/, "unread notifications should not use negative margins inside cards");
  assert.doesNotMatch(html, /style="/, "dashboard shell should not rely on inline layout styles");
  assert.doesNotMatch(js, /style="/, "dashboard-rendered states should not rely on inline layout styles");
});
