import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin stats exposes operations grouped metrics and action list", () => {
  const src = read("functions/api/admin/stats.js");
  assert.match(src, /commerce\s*:/, "stats payload should expose commerce group");
  assert.match(src, /crm\s*:/, "stats payload should expose CRM group");
  assert.match(src, /accounts\s*:/, "stats payload should expose accounts group");
  assert.match(src, /catalog_health\s*:/, "stats payload should expose catalog health group");
  assert.match(src, /analytics\s*:/, "stats payload should expose analytics group");
  assert.match(src, /actions\s*:/, "stats payload should expose prioritized actions");
  assert.match(src, /average_order_value/, "commerce group should include AOV");
  assert.match(src, /fulfillment_queue/, "commerce group should include fulfillment queue");
  assert.match(src, /net_exposure/, "commerce group should include NET exposure");
});

test("admin traffic aggregates funnel events campaigns and daily conversion rows", () => {
  const src = read("functions/api/admin/traffic.js");
  assert.match(src, /eventCounts/, "traffic should count event names");
  assert.match(src, /funnel/, "traffic payload should include funnel");
  assert.match(src, /topCampaigns/, "traffic payload should include UTM campaign groups");
  assert.match(src, /utm_source/, "traffic query should select UTM source");
  assert.match(src, /utm_medium/, "traffic query should select UTM medium");
  assert.match(src, /utm_campaign/, "traffic query should select UTM campaign");
  assert.match(src, /conversion_events/, "daily rows should include conversion event count");
});

test("admin overview renders operations summary and action rail", () => {
  const html = read("admin.html");
  const js = read("js/admin.js");
  assert.match(html, /admActionRail/, "overview shell should include action rail");
  assert.match(html, /admOpsSummary/, "overview shell should include operations summary");
  assert.match(js, /renderActionRail/, "admin JS should render priority actions");
  assert.match(js, /renderOpsSummary/, "admin JS should render grouped operations summary");
});

test("admin traffic page renders funnel campaigns and daily report", () => {
  const js = read("js/admin.js");
  assert.match(js, /renderTrafficFunnel/, "traffic page should render funnel");
  assert.match(js, /renderTrafficCampaigns/, "traffic page should render campaigns");
  assert.match(js, /renderTrafficDays/, "traffic page should render daily rows");
  assert.match(js, /topCampaigns/, "traffic renderer should use topCampaigns payload");
  assert.match(js, /conversion_events/, "traffic renderer should show daily conversion events");
});
