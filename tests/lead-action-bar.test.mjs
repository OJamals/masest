import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Mobile lead-action bar lives in shared chrome (js/main/chrome.js) and is styled
// in css/navigation.css. These are static source-regression guards (matching the
// repo's test convention) that lock its three contracts: hidden at load, revealed
// at the right scroll point, and pointing at the correct quote / chemical-audit
// intents from every page that renders it — including industry detail pages that
// sit one directory deep and therefore need a root-relative prefix.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chrome = read("js/main/chrome.js");
const css = read("css/navigation.css");
const engagement = read("js/main/engagement.js");

// Isolate the lead-bar block so assertions can't be satisfied by unrelated code.
const leadBlock = (() => {
  const start = chrome.indexOf("const leadBar = document.createElement");
  const end = chrome.indexOf("const burger = document.getElementById");
  assert.ok(start !== -1 && end > start, "lead-action bar block should exist in chrome.js");
  return chrome.slice(start, end);
})();

test("lead bar starts hidden at load", () => {
  // JS: visibility is forced off before the observer is ever wired up.
  const offIndex = leadBlock.indexOf("setLeadVisible(false)");
  const observeIndex = leadBlock.indexOf("leadObserver.observe");
  assert.ok(offIndex !== -1, "lead bar must call setLeadVisible(false) at init");
  assert.ok(observeIndex > offIndex, "lead bar must hide before it starts observing scroll");

  // CSS: bar is display:none by default and opacity/visibility off on mobile,
  // so there is no first-paint flash before the observer runs.
  assert.match(css, /\.lead-action-bar\s*\{\s*display:\s*none;/, "lead bar must default to display:none");
  assert.match(css, /\.lead-action-bar\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;/s,
    "mobile lead bar must be opacity:0 + visibility:hidden until revealed");
});

test("lead bar reveals at the right scroll point via the sentinel", () => {
  // A 1px sentinel anchored partway down the page drives an IntersectionObserver:
  // while the sentinel is in view (top of page) the bar is hidden; once scrolled
  // past it the bar becomes visible.
  assert.match(leadBlock, /className\s*=\s*"lead-action-sentinel"/, "must create a scroll sentinel");
  assert.match(leadBlock, /leadObserver\.observe\(leadSentinel\)/, "must observe the sentinel");
  assert.match(leadBlock, /setLeadVisible\(!entries\[0\]\?\.isIntersecting\)/,
    "bar visibility must invert the sentinel's intersection state");

  // Sentinel sits below the hero but within the first viewport so it is in view at
  // load (=> hidden) and leaves the viewport on a modest scroll (=> revealed).
  assert.match(css, /\.lead-action-sentinel\s*\{[^}]*position:\s*absolute;[^}]*top:\s*min\(560px,\s*75vh\);/s,
    "sentinel must be absolutely positioned at min(560px, 75vh)");
  assert.match(css, /\.lead-action-bar\.is-visible\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s,
    "is-visible must reveal the bar");
});

test("lead bar still shows without IntersectionObserver support", () => {
  assert.match(leadBlock, /else\s*\{\s*setLeadVisible\(true\);?\s*\}/,
    "fallback must show the bar when IntersectionObserver is unavailable");
});

test("lead bar links target root-relative quote and chemical-audit intents", () => {
  // Both links must carry the ${root} prefix so they resolve from /industries/*.html
  // (one level deep) as well as top-level pages.
  assert.match(leadBlock, /href="\$\{root\}contact\.html\?type=audit"/,
    "chemical-audit link must be root-relative contact.html?type=audit");
  assert.match(leadBlock, /href="\$\{root\}contact\.html\?type=quote"/,
    "quote link must be root-relative contact.html?type=quote");
});

test("industry detail pages prefix chrome links one level up", () => {
  assert.match(chrome, /const root = \/\\\/industries\\\/\/\.test\(location\.pathname\) \? "\.\.\/" : "";/,
    "root must resolve to ../ for pages under /industries/");
});

test("lead bar renders on product and industry pages", () => {
  // Product detail + catalog pages.
  assert.match(chrome, /leadBarPages = new Set\(\[[^\]]*"product\.html"/s, "lead bar must render on product.html");
  assert.match(chrome, /leadBarPages = new Set\(\[[^\]]*"products\.html"/s, "lead bar must render on products.html");
  assert.match(chrome, /leadBarPages = new Set\(\[[^\]]*"industries\.html"/s, "lead bar must render on industries.html");
  // Industry detail pages are matched by path, not the page-name set.
  assert.match(chrome, /isIndustryDetail = \/\\\/industries\\\/\[\^\/\]\+\\\.html\$\/\.test\(location\.pathname\)/,
    "industry detail pages must be matched by pathname");
  assert.match(chrome, /if \(leadBarPages\.has\(page\) \|\| isIndustryDetail\)/,
    "lead bar gating must include industry detail pages");
});

test("lead bar exposes an accessible labelled group", () => {
  // aria-label on a plain <div> is inert without a role; the group role makes the
  // label announce to assistive tech.
  assert.match(leadBlock, /setAttribute\("role",\s*"group"\)/, "lead bar must declare role=group");
  assert.match(leadBlock, /setAttribute\("aria-label",\s*"Primary request actions"\)/,
    "lead bar must keep its accessible label");
});

test("contact form honors the lead bar's quote and audit intents", () => {
  // Cross-check the link targets actually resolve to real intents so the bar can
  // never silently point at a dead ?type= value.
  assert.match(engagement, /INTENTS = \[[^\]]*"quote"[^\]]*"audit"[^\]]*\]/, "engagement intents must include quote + audit");
  assert.match(engagement, /params\.get\("type"\)/, "contact form must read ?type= from the URL");
});
