import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../js/business.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../js/dashboard.js", import.meta.url), "utf8");
const dashboardHtml = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");

// Self-serve NET checkout was removed when cart.html split into cart.html + checkout.html.
// The logged-in surfaces must state the terms a company actually holds and route new
// on-account orders to the quote form, never announce an ordering capability the
// storefront cannot deliver.
test("business NET copy routes to the account team instead of promising a self-serve unlock", () => {
  assert.match(source, /approved:\s*data\.can_use_net_terms\s*\?/, "approved copy should branch on the NET terms entitlement");
  assert.doesNotMatch(
    source,
    /NET terms, programs, and QuickBooks invoicing are unlocked/,
    "business copy must not tell a verified company that NET ordering is unlocked",
  );
  assert.doesNotMatch(
    source,
    /NET invoicing through QuickBooks unlocks/,
    "invoicing copy must not promise NET billing turns on by itself",
  );
  const quoteLinks = source.match(/contact\.html\?type=quote/g) || [];
  assert.ok(
    quoteLinks.length >= 3,
    `business copy should route on-account orders to the quote form on every NET surface (found ${quoteLinks.length})`,
  );
});

test("dashboard NET copy states the terms held and offers the quote route", () => {
  assert.doesNotMatch(
    dashboard,
    /unlock B2B ordering, NET terms/,
    "dashboard setup copy must not promise NET terms unlock on approval",
  );
  assert.doesNotMatch(
    dashboard,
    /B2B ordering, NET terms, and programs unlock/,
    "dashboard verification copy must not promise NET terms unlock on approval",
  );
  assert.match(
    dashboard,
    /contact\.html\?type=quote/,
    "dashboard should route a NET terms request to the quote form",
  );
});

test("dashboard requests the matching business module release", () => {
  const dashboardRelease = dashboardHtml.match(/dashboard\.js\?v=(\d{8}[a-z])/);
  assert.ok(dashboardRelease, "dashboard should cache-bust its module entrypoint");
  assert.match(dashboard, new RegExp(`business\\.js\\?v=${dashboardRelease[1]}`), "dashboard should request the matching business module release");
});
