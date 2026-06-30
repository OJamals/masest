import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("buyer dashboard overview has procurement action and activity mounts", () => {
  const html = read("dashboard.html");
  assert.match(html, /id="ovActionRail"/, "overview should mount procurement next actions");
  assert.match(html, /id="ovRecentOrders"/, "overview should mount recent order activity");
  assert.match(html, /id="ovRecentMessages"/, "overview should mount recent message activity");
});

test("buyer dashboard renders procurement actions and recent activity", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /function renderBuyerActionRail/, "dashboard should render next action rail");
  assert.match(js, /function renderRecentOrders/, "dashboard should render recent orders");
  assert.match(js, /function renderRecentMessages/, "dashboard should render recent messages");
  assert.match(js, /function renderOverviewActivity/, "overview should coordinate recent activity fetches");
  assert.match(js, /\/api\/account\/messages/, "overview activity should reuse account messages API");
  assert.match(js, /fetchOrders\(\{ limit: 100 \}\)/, "overview activity should reuse account orders API");
});

test("buyer dashboard action rail includes commerce and setup actions", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /Review business tools/, "pending setup should route to business hub");
  assert.match(js, /Review cart/, "approved buyers should have commerce CTA");
  assert.match(js, /Message MASEST/, "messages should remain one click away");
  assert.match(js, /data-buyer-action/, "actions should expose stable hooks for QA");
  assert.match(js, /function wirePanelLinks/, "overview CTAs should switch dashboard panels");
});

test("overview message preview does not clear unread message state", () => {
  const js = read("js/dashboard.js");
  const api = read("functions/api/account/messages.js");
  assert.match(js, /\/api\/account\/messages\?peek=1/, "overview should preview messages without marking them read");
  assert.match(api, /searchParams\.get\('peek'\) === '1'/, "messages API should expose a peek mode");
  assert.match(api, /if \(!peek\)[\s\S]+read_by_user: true/, "normal message tab load should still mark staff messages read");
});
