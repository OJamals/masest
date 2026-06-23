import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Mobile lead-action bar lives in shared chrome and is styled in navigation.css.
// These static source guards lock its scroll behavior, route targets, and
// deep-page rendering contract.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chrome = read("js/main/chrome.js");
const css = read("css/navigation.css");
const engagement = read("js/main/engagement.js");

const leadBlock = (() => {
  const start = chrome.indexOf("const leadBar = document.createElement");
  const end = chrome.indexOf("const burger = document.getElementById");
  assert.ok(start !== -1 && end > start, "lead-action bar block should exist in chrome.js");
  return chrome.slice(start, end);
})();

test("lead bar starts hidden at load", () => {
  const offIndex = leadBlock.indexOf("setLeadVisible(false)");
  const observeIndex = leadBlock.indexOf("leadObserver.observe");
  assert.ok(offIndex !== -1, "lead bar must call setLeadVisible(false) at init");
  assert.ok(observeIndex > offIndex, "lead bar must hide before it starts observing scroll");

  assert.match(css, /\.lead-action-bar\s*\{\s*display:\s*none;/, "lead bar must default to display:none");
  assert.match(css, /\.lead-action-bar\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;/s, "lead bar must be visually hidden by default");
});

test("lead bar reveals at right scroll point via sentinel", () => {
  assert.match(css, /\.lead-action-sentinel\s*\{[^}]*position:\s*absolute;[^}]*top:\s*min\(560px,\s*75vh\);/s, "sentinel must be positioned below the hero");
  assert.match(css, /\.lead-action-bar\.is-visible\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s, "is-visible must reveal bar");
});

test("lead bar still shows without IntersectionObserver support", () => {
  assert.match(leadBlock, /else\s*\{\s*setLeadVisible\(true\);?\s*\}/, "fallback must show bar when IntersectionObserver is unavailable");
});

test("lead bar links target root-relative quote chemical-audit intents", () => {
  assert.match(leadBlock, /href="\$\{root\}contact\?type=audit"/, "chemical-audit link must be root-relative contact?type=audit");
  assert.match(leadBlock, /href="\$\{root\}contact\?type=quote"/, "quote link must be root-relative contact?type=quote");
});

test("detail pages prefix chrome links one level up", () => {
  assert.ok(
    chrome.includes('const root = /\\/(?:industries|products)\\//.test(location.pathname) ? "../" : "";'),
    "root must resolve to ../ for pages under /industries/ and /products/"
  );
});

test("lead bar renders on product and industry pages", () => {
  assert.match(chrome, /leadBarPages = new Set\(\[[^\]]*"products"/s, "lead bar must render on products");
  assert.match(chrome, /leadBarPages = new Set\(\[[^\]]*"industries"/s, "lead bar must render on industries");
  assert.ok(
    chrome.includes('const isProductDetail = /\\/products\\/[^/]+(?:\\.html)?$/.test(location.pathname);'),
    "product detail pages must be matched by pathname"
  );
  assert.ok(
    chrome.includes('const isIndustryDetail = /\\/industries\\/[^/]+(?:\\.html)?$/.test(location.pathname);'),
    "industry detail pages must be matched by pathname"
  );
  assert.match(
    chrome,
    /if \(leadBarPages\.has\(page\) \|\| isIndustryDetail \|\| isProductDetail\)/,
    "lead bar gating must include industry and product detail pages"
  );
});

test("lead bar exposes an accessible labelled group", () => {
  assert.match(leadBlock, /setAttribute\("role",\s*"group"\)/, "lead bar must declare role=group");
  assert.match(leadBlock, /setAttribute\("aria-label",\s*"Primary request actions"\)/, "lead bar must keep its accessible label");
});

test("contact form honors lead bar's quote audit intents", () => {
  assert.match(engagement, /INTENTS = \[[^\]]*"quote"[^\]]*"audit"[^\]]*\]/, "engagement intents must include quote + audit");
  assert.match(engagement, /params\.get\("type"\)/, "contact form must read ?type= from URL");
});
