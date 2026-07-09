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
  assert.match(html, /id="bulkNotes"[^>]+placeholder="Timing notes \(optional\)"/, "bulk-order timing placeholder should fit mobile input width");
  assert.doesNotMatch(businessPanel, /style="/, "business panel should not rely on inline style polish");
  assert.match(html, /tier-grid/, "program tier layout should remain explicit and responsive");
});

test("admin dashboard has production shell affordances without inline layout hacks", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");

  assert.match(html, /adm-tabs-wrap/, "admin tab rail should keep its mobile-safe scroll container class");
  assert.match(html, /class="adm-layout"/, "admin app should use a dashboard-style two-column shell");
  assert.match(html, /class="adm-sidebar adm-tabs-wrap"/, "admin sections should live in a sidebar rail");
  assert.match(html, /class="adm-nav-group"[\s\S]*<span aria-hidden="true">Operations<\/span>/, "admin nav should group operational sections");
  assert.match(html, /adm-panel-header/, "admin panels should expose consistent panel header utility");
  assert.match(html, /adm-inline-actions/, "admin inline action rows should use reusable classes");
  assert.doesNotMatch(html, /style="/, "admin shell should not rely on inline style polish");
  assert.match(js, /from\s+["']\.\/admin\/seo\.js(?:\?v=\d{8}[a-z])?["']/, "admin should import the split SEO-audit module");
  const seo = read("js/admin/seo.js"); // SEO-audit tab extracted in #36 split
  assert.match(seo, /SEO audit[\s\S]*seo-audit-list/, "admin SEO audit should render in a responsive list");
  assert.doesNotMatch(seo, /<table class="adm"/, "admin SEO audit should not hide mobile content in a wide table");
});

test("dashboard panels protect form and notification text from clipping", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");

  assert.match(html, /\.dash-card \.field-grid/, "dashboard forms should override public-page field grid widths");
  assert.match(html, /\.dash-tab\s*\{[^}]*position:\s*relative/, "dashboard notification bubbles should anchor to tab button corners");
  assert.match(html, /\.dash-tab \.pill\s*\{[^}]*position:\s*absolute[^}]*top:\s*-[^;}]+[^}]*right:\s*-[^;}]+/, "dashboard notification bubbles should sit outside tab button chrome");
  assert.match(html, /\.dash-tab \.pill\[hidden\]\s*\{\s*display:\s*none/, "dashboard zero-count notification bubbles should stay hidden");
  assert.match(html, /\.notif-body > \*/, "notification content should wrap inside card width");
  assert.match(html, /\.notif-prefs\s*\{[^}]*display:\s*flex/, "notification preferences should use a reusable layout class");
  assert.match(html, /class="notif-pref-label"/, "notification preference labels should use reusable classes");
  assert.match(html, /\.dash-pager/, "dashboard pagers should use reusable spacing classes");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-sidebar \.dash-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "mobile dashboard nav should show all sections in a no-overflow grid");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-nav-group\s*\{\s*display:\s*contents;\s*\}/, "mobile dashboard nav should flatten grouped sections");
  assert.doesNotMatch(html, /\.notif\.unread\s*\{[^}]*margin:\s*0\s+-/, "unread notifications should not use negative margins inside cards");
  assert.doesNotMatch(html, /style="/, "dashboard shell should not rely on inline layout styles");
  assert.doesNotMatch(js, /style="/, "dashboard-rendered states should not rely on inline layout styles");
});

test("visual QA padding contracts cover disclosures and dense admin controls", () => {
  const css = read("css/style.css");
  const dashboard = read("dashboard.html");
  const admin = read("admin.html");
  const adminJs = read("js/admin.js");
  const audit = read("tools/visual-layout-audit.mjs");

  assert.match(css, /\.services-faq-list \.resource-disclosure > p\s*\{[\s\S]*padding:\s*0 clamp/, "service FAQ answers should keep body padding even without a disclosure-body wrapper");
  assert.match(css, /\.foot-legal a\s*\{[\s\S]*min-height:\s*44px/, "footer legal links should keep touch-sized hit areas");
  assert.match(dashboard, /\.dash-disclosure summary\s*\{[\s\S]*min-height:\s*44px/, "dashboard disclosure summaries should keep a touch-sized hit area");
  assert.match(dashboard, /\.biz-detail-options summary\s*\{[\s\S]*min-height:\s*44px/, "business-detail summaries should keep a touch-sized hit area");
  assert.match(dashboard, /\.dash-order-summary\s*\{[\s\S]*min-height:\s*44px/, "order summaries should not collapse into cramped rows");
  assert.match(admin, /\.adm-track summary\s*\{[\s\S]*min-height:\s*44px/, "admin tracking disclosures should keep a touch-sized hit area");
  assert.match(admin, /\.adm-content-json summary\s*\{[\s\S]*min-height:\s*44px/, "admin content disclosures should keep a touch-sized hit area");
  assert.match(admin, /\.adm-tab\s*\{[^}]*position:\s*relative/, "admin notification bubbles should anchor to tab button corners");
  assert.match(admin, /\.adm-tab \.pill\s*\{[^}]*position:\s*absolute[^}]*top:\s*-[^;}]+[^}]*right:\s*-[^;}]+/, "admin notification bubbles should sit outside tab button chrome");
  assert.match(admin, /\.adm-tab \.pill\[hidden\]\s*\{\s*display:\s*none/, "admin zero-count notification bubbles should stay hidden");
  assert.match(admin, /\.company-admin-head \.link-name\s*\{[\s\S]*background:\s*transparent/, "company-name buttons should not render with native button chrome");
  assert.match(admin, /\.admin-order-actions \.admin-input-sm\s*\{[\s\S]*flex-basis:\s*220px/, "QBO and payment IDs should get enough inline width on desktop");
  assert.match(admin, /\.product-file-control input\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%/, "product image upload controls should use the available mobile card width");
  assert.match(admin, /@media \(max-width: 720px\)[\s\S]*\.adm-coupon-form\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "mobile coupon controls should use a bounded grid instead of cramped flex wrapping");
  const inventoryJs = read("js/admin/inventory.js");
  const couponsJs = read("js/admin/coupons.js");
  assert.match(inventoryJs, /invLow[\s\S]*<div class="adm-table-wrap">[\s\S]*low-stock variants/, "low-stock admin tables should scroll inside cards instead of clipping columns");
  assert.match(couponsJs, /cpList[\s\S]*<div class="adm-table-wrap">[\s\S]*promo code/, "promo-code tables should scroll inside cards instead of clipping columns");
  assert.match(audit, /hasCornerCounterOverflow[\s\S]*\.dash-tab, \.adm-tab/, "visual audit should allow only tab counter pills to extend outside button corners");
});
