import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("user and business dashboard tab changes preserve the page scroll", () => {
  const source = read("js/dashboard.js");

  assert.doesNotMatch(source, /window\.scrollTo\(/);
  assert.doesNotMatch(
    source,
    /activeTab\.scrollIntoView/,
    "centering a dashboard tab must not move the outer page",
  );
});

test("dashboard tab changes reserve the active panel height before hiding it", () => {
  const source = read("js/dashboard.js");

  assert.match(source, /function reserveDashboardHeight\(\)/);
  assert.match(source, /reserveDashboardHeight\(\);\s*\n\s*document\.querySelectorAll\('\.dash-panel'\)/);
  assert.match(source, /main\.style\.minHeight/);
});

test("dashboard panel swaps opt out of browser scroll anchoring", () => {
  const dashboard = read("dashboard.html");

  assert.match(dashboard, /\.dash-main\s*\{[^}]*overflow-anchor:\s*none/);
});

test("admin dashboard tab changes preserve the page scroll", () => {
  const source = read("js/admin.js");

  assert.doesNotMatch(source, /window\.scrollTo\(/);
});

test("dashboard sidebars release wheel scrolling to the page at their boundaries", () => {
  const dashboard = read("dashboard.html");
  const admin = read("admin.html");

  assert.doesNotMatch(dashboard, /\.dash-sidebar\s*\{[^}]*overscroll-behavior:\s*contain/);
  assert.doesNotMatch(admin, /\.adm-sidebar\.adm-tabs-wrap\s*\{[^}]*overscroll-behavior:\s*contain/);
});
