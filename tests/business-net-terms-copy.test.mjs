import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");

test("approved business copy reflects the NET terms entitlement", () => {
  assert.match(source, /approved:\s*data\.can_use_net_terms\s*\?/, "approved copy should branch on the NET terms entitlement");
  assert.match(source, /B2B ordering, NET terms, programs, and QuickBooks invoicing are unlocked\./, "active NET terms should be confirmed");
  assert.match(source, /NET terms are not enabled yet\./, "inactive NET terms should stay explicit");
  assert.match(dashboard, /business\.js\?v=20260710g/, "dashboard should request the updated business module instead of a cached copy");
});
