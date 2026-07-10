import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const dashboardHtml = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");

test("approved business copy reflects the NET terms entitlement", () => {
  assert.match(source, /approved:\s*data\.can_use_net_terms\s*\?/, "approved copy should branch on the NET terms entitlement");
  assert.match(source, /B2B ordering, NET terms, programs, and QuickBooks invoicing are unlocked\./, "active NET terms should be confirmed");
  assert.match(source, /NET terms are not enabled yet\./, "inactive NET terms should stay explicit");
  const dashboardRelease = dashboardHtml.match(/dashboard\.js\?v=(\d{8}[a-z])/);
  assert.ok(dashboardRelease, "dashboard should cache-bust its module entrypoint");
  assert.match(dashboard, new RegExp(`business\\.js\\?v=${dashboardRelease[1]}`), "dashboard should request the matching business module release");
});
