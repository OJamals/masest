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
  assert.match(js, /class="field"><select data-role-for=/, "team role controls should reuse shared touch-sized field styling");
  assert.match(html, /\.biz-inv-table\s*\{[^}]*table-layout:\s*fixed/, "invoice columns should stay inside mobile cards");
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*#bizTeam \.biz-row > :first-child\s*\{\s*flex:\s*0 1 auto/, "mobile team rows should drop desktop column flex-basis");
  assert.doesNotMatch(businessPanel, /style="/, "business panel should not rely on inline style polish");
  assert.match(html, /tier-grid/, "program tier layout should remain explicit and responsive");
});

test("admin dashboard has production shell affordances without inline layout hacks", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");

  // The marketing hero was removed: an operator opens straight into the work.
  // A screen-reader-only h1 keeps the document outline intact.
  assert.doesNotMatch(html, /class="page-hero adm-hero"/, "admin should not carry a marketing hero");
  assert.match(html, /<h1 class="sr-only">Operations control room<\/h1>/);
  assert.match(html, /\.adm-panel-title h2\s*\{[^}]*font-size:\s*clamp\(/);
  assert.match(html, /adm-tabs-wrap/, "admin tab rail should keep its mobile-safe scroll container class");
  assert.match(html, /class="adm-layout"/, "admin app should use a dashboard-style two-column shell");
  assert.match(html, /class="adm-sidebar adm-tabs-wrap"/, "admin sections should live in a sidebar rail");
  for (const group of ["Today", "Sales", "Orders &amp; catalog", "Publishing", "Business system"]) {
    assert.match(html, new RegExp(`<span aria-hidden="true">${group}<\\/span>`), `admin nav should expose the ${group} group`);
  }
  assert.match(html, /adm-panel-header/, "admin panels should expose consistent panel header utility");
  assert.match(html, /adm-inline-actions/, "admin inline action rows should use reusable classes");
  assert.doesNotMatch(html, /style="/, "admin shell should not rely on inline style polish");
  assert.match(js, /import\(\s*["']\.\/admin\/seo\.js\?v=\d{8}[a-z]["']\s*\)/, "admin should lazy-import the split SEO-audit module");
  const seo = read("js/admin/seo.js"); // SEO-audit tab extracted in #36 split
  assert.match(seo, /SEO audit[\s\S]*seo-audit-list/, "admin SEO audit should render in a responsive list");
  assert.doesNotMatch(seo, /<table class="adm"/, "admin SEO audit should not hide mobile content in a wide table");
});

test("dashboard panels protect form and notification text from clipping", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");

  assert.match(html, /class="hero-split dashboard-hero"/);
  assert.match(html, /class="section section-slim dashboard-workspace"/);
  assert.match(html, /\.dash-card \.field-grid/, "dashboard forms should override public-page field grid widths");
  assert.match(html, /\.dash-tab\s*\{[^}]*position:\s*relative/, "dashboard notification bubbles should anchor to tab button corners");
  assert.match(html, /\.dash-tab \.pill\s*\{[^}]*position:\s*absolute[^}]*top:\s*-[^;}]+[^}]*right:\s*-[^;}]+/, "dashboard notification bubbles should sit outside tab button chrome");
  assert.match(html, /\.dash-tab \.pill\[hidden\]\s*\{\s*display:\s*none/, "dashboard zero-count notification bubbles should stay hidden");
  assert.match(html, /\.notif-body > \*/, "notification content should wrap inside card width");
  assert.match(html, /\.notif-prefs\s*\{[^}]*display:\s*flex/, "notification preferences should use a reusable layout class");
  assert.match(html, /class="notif-pref-label"/, "notification preference labels should use reusable classes");
  assert.match(html, /\.dash-pager/, "dashboard pagers should use reusable spacing classes");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-sidebar \.dash-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "mobile dashboard nav should expose every section in a compact grid");
  assert.match(html, /@media \(max-width: 820px\)[\s\S]*\.dash-nav-group\s*\{\s*display:\s*contents;\s*\}/, "mobile dashboard nav should flatten grouped sections");
  assert.doesNotMatch(html, /\.notif\.unread\s*\{[^}]*margin:\s*0\s+-/, "unread notifications should not use negative margins inside cards");
  assert.doesNotMatch(html, /style="/, "dashboard shell should not rely on inline layout styles");
  assert.doesNotMatch(js, /style="/, "dashboard-rendered states should not rely on inline layout styles");
});

test("visual QA padding contracts cover disclosures and dense admin controls", () => {
  const css = read("css/style.css");
  const components = read("css/components.css");
  const dashboard = read("dashboard.html");
  const admin = read("admin.html");
  const adminJs = read("js/admin.js");
  const adminPricing = read("js/admin/pricing.js");
  const adminQuotes = read("js/admin/quotes.js");
  const audit = read("tools/visual-layout-audit.mjs");

  assert.match(css, /\.services-faq-list \.resource-disclosure > p\s*\{[\s\S]*padding:\s*0 clamp/, "service FAQ answers should keep body padding even without a disclosure-body wrapper");
  assert.match(components, /\.rv-field input, \.rv-field select, \.rv-field textarea\s*\{[^}]*min-height:\s*44px/, "review form controls should keep touch-sized hit areas");
  assert.match(css, /\.foot-legal a\s*\{[\s\S]*min-height:\s*44px/, "footer legal links should keep touch-sized hit areas");
  assert.match(css, /\.case-disclosure summary::after\s*\{[^}]*margin-right:\s*3px/, "proof disclosure chevrons should stay inside their scroll box");
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
  assert.match(admin, /\.product-cms-image\s*\{[^}]*width:\s*100%/, "product CMS image controls should use the available mobile card width");
  assert.match(admin, /@media \(max-width: 720px\)[\s\S]*\.adm-coupon-form\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "mobile coupon controls should use a bounded grid instead of cramped flex wrapping");
  assert.match(admin, /@media \(max-width: 420px\)[\s\S]*\.adm-action-item\s*\{[\s\S]*grid-template-columns:\s*38px minmax\(0,\s*1fr\)/, "tiny mobile admin action rows should let the count wrap below long action copy");
  const inventoryJs = read("js/admin/inventory.js");
  const couponsJs = read("js/admin/coupons.js");
  assert.match(inventoryJs, /invLow[\s\S]*<div class="adm-table-wrap">[\s\S]*low-stock variants/, "low-stock admin tables should scroll inside cards instead of clipping columns");
  assert.match(couponsJs, /cpList[\s\S]*<div class="adm-table-wrap">[\s\S]*promo code/, "promo-code tables should scroll inside cards instead of clipping columns");
  assert.equal((adminPricing.match(/class="adm-table-wrap"/g) || []).length, 3, "all unified pricing tables should use the admin scroll boundary");
  assert.doesNotMatch(adminPricing, /class="table-scroll"/, "admin pricing should not inherit public comparison-table mobile behavior");
  assert.match(adminQuotes, /id="qBulkOwner"[^>]+aria-label="Assign selected leads to owner"/, "bulk owner control should have a stable accessible name");
  assert.match(audit, /hasCornerCounterOverflow[\s\S]*\.dash-tab, \.adm-tab/, "visual audit should allow only tab counter pills to extend outside button corners");
  assert.doesNotMatch(audit, /async function captureStep\(browser/, "visual audit should not churn one browser context per page");
  assert.match(audit, /const publicContext = await newContext\(browser, viewport, false\)/, "visual audit should reuse one public context per viewport");
  assert.match(audit, /const authContext = await newContext\(browser, viewport, true\)/, "visual audit should reuse one authenticated context per viewport");
  assert.match(audit, /await page\.close\(\)/, "each captured page should still be released promptly");
  assert.doesNotMatch(audit, /admin-(?:messages|offers|traffic)/, "visual audit should target current admin panels, not legacy hash aliases");
  assert.match(audit, /\["admin-pricing", "\/admin\.html#pricing"\]/, "visual audit should capture the unified pricing workspace");
  assert.match(audit, /pricing-hvac-facilities/, "visual audit should capture HVAC runtime pricing");
  assert.match(audit, /pricing-cip-food-beverage/, "visual audit should capture CIP runtime pricing");
  assert.match(audit, /\["resources-pricing-expanded", "\/resources\.html"\]/, "visual audit should capture expanded runtime resource pricing tables");
  assert.match(audit, /context\.route\("\*\*\/api\/pricing"/, "visual audit should supply canonical runtime pricing");
  assert.match(audit, /context\.route\("\*\*\/api\/reviews\*\*"/, "visual audit should isolate public review hydration from the static preview server");
  assert.match(audit, /pathname\.startsWith\("\/api\/admin\/variant-pricing"\)[\s\S]*\brows\b[\s\S]*\bservices\b[\s\S]*\bprograms\b/, "visual audit should exercise every unified admin pricing section");
  assert.match(audit, /page\.on\("console"/, "visual audit should capture browser console regressions");
  assert.match(audit, /page\.on\("requestfailed"/, "visual audit should capture failed requests");
  assert.match(audit, /profile:\s*\{\s*full_name:[^}]+role:\s*"admin"/, "authenticated visual fixture should exercise company-admin controls");
  assert.match(audit, /active_total:\s*fixtures\.orders\.length/, "authenticated visual fixture should expose server-derived active-order totals");
  assert.match(audit, /context\.route\("\*\*\/js\/auth\.js\*"/, "visual audit should intercept cache-busted auth module URLs");
  assert.match(audit, /auth && location\.origin === origin/, "visual audit should not touch localStorage in opaque-origin documents");
  assert.ok(audit.includes('execFileSync("npm", ["run", "build"]') && audit.includes('cwd: path.join(ROOT_PATH, "dist")'), "visual audit should build and serve production output");
});
