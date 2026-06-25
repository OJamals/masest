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
  assert.match(js, /scrollIntoView\(\{\s*block:\s*'nearest',\s*inline:\s*'center'\s*\}\)/, "overflowing mobile tab rails should reveal the active tab");
  assert.match(js, /addEventListener\('keydown'/, "keyboard activation should match click activation");
});

test("message notifications default to the messages panel", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /n\.type === 'message'[\s\S]+dashboard\.html#messages/, "message notifications should open the messages panel even when the API omits a link");
});

test("account-only dashboard guides business setup instead of failing tabs", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /Your account is active\. Set up a business profile/, "dashboard should distinguish active user accounts from business approval");
  assert.match(js, /Business setup required/, "messages tab should explain business setup before company-scoped threads");
  assert.match(js, /Create a business profile before placing or tracking company orders/, "orders tab should not call company-scoped APIs before business setup");
  assert.match(js, /No business notifications yet/, "notifications tab should not show a load failure before business setup");
  assert.match(js, /No business profile yet/, "addresses tab should explain business setup before company-scoped addresses");
  assert.match(js, /Available after you create a business profile and MASEST approves it/, "payment tab should name the account-only locked state");
  assert.match(js, /ACCOUNT\?\.company \? 'Open business setup' : 'Set up business'/, "next action should promote business creation for account-only users");
});

test("Stripe billing portal opens outside the dashboard shell", () => {
  const dashboard = read("js/dashboard.js");
  const business = read("js/business.js");

  assert.match(dashboard, /window\.open\('about:blank', '_blank'/, "dashboard should reserve a new tab before awaiting the portal URL");
  assert.match(business, /window\.open\('about:blank', '_blank'/, "business hub should reserve a new tab before awaiting the portal URL");
  assert.doesNotMatch(dashboard, /location\.href\s*=\s*url;/, "dashboard payment portal should not replace the account dashboard tab");
  assert.doesNotMatch(business, /window\.location\.assign\(out\.url\)/, "business payment portal should not replace the business hub tab");
});
