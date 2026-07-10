import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("user and business dashboard tab changes reset only the page scroll", () => {
  const source = read("js/dashboard.js");

  assert.match(source, /const tabChanged = activeDashboardTab && activeDashboardTab !== name/);
  assert.match(source, /if \(tabChanged\) resetDashboardScroll\(\)/);
  assert.match(source, /function resetDashboardScroll\(\)[\s\S]*window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.doesNotMatch(
    source,
    /activeTab\.scrollIntoView/,
    "centering a dashboard tab must not move the outer page",
  );
});

test("admin dashboard tab changes reset the page before rendering the new panel", () => {
  const source = read("js/admin.js");

  assert.match(source, /const previousTab = state\.tab/);
  assert.match(source, /const tabChanged = previousTab && previousTab !== state\.tab/);
  assert.match(source, /if \(tabChanged\) resetAdminScroll\(\)/);
  assert.match(source, /function resetAdminScroll\(\)[\s\S]*window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
});
