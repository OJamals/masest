import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard notifications open same-page targets without reloading", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /function resolveNotificationTarget/, "notifications should normalize message/order/account targets");
  assert.match(js, /data-notif-link/, "notification rows should carry their navigation target");
  assert.match(js, /function openNotification/, "notification activation should be centralized");
  assert.match(js, /selectTab\(DASH_TABS\.includes\(hash\) \? hash : 'overview'\)/, "same-dashboard notification links should switch tabs in-page");
  assert.match(js, /addEventListener\('keydown'/, "keyboard activation should match click activation");
});

test("message notifications default to the messages panel", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /n\.type === 'message'[\s\S]+dashboard\.html#messages/, "message notifications should open the messages panel even when the API omits a link");
});

test("Stripe billing portal opens outside the dashboard shell", () => {
  const dashboard = read("js/dashboard.js");
  const business = read("js/business.js");

  assert.match(dashboard, /window\.open\('about:blank', '_blank'/, "dashboard should reserve a new tab before awaiting the portal URL");
  assert.match(business, /window\.open\('about:blank', '_blank'/, "business hub should reserve a new tab before awaiting the portal URL");
  assert.doesNotMatch(dashboard, /location\.href\s*=\s*url;/, "dashboard payment portal should not replace the account dashboard tab");
  assert.doesNotMatch(business, /window\.location\.assign\(out\.url\)/, "business payment portal should not replace the business hub tab");
});
