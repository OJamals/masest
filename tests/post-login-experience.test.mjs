import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function extractConst(js, name) {
  const match = js.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(match, `${name} should be defined`);
  return match[0];
}

function extractFunction(js, name) {
  const start = js.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should be defined`);
  let depth = 0;
  let end = -1;
  for (let i = js.indexOf("{", start); i < js.length; i += 1) {
    if (js[i] === "{") depth += 1;
    if (js[i] === "}") depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, `${name} should parse`);
  return js.slice(start, end);
}

function dashboardRouting(js) {
  return new Function(`
    ${extractConst(js, "DASH_TABS")}
    ${extractConst(js, "DASH_TAB_ALIASES")}
    ${extractFunction(js, "dashboardTabFromHash")}
    return { dashboardTabFromHash };
  `)();
}

function notificationRouting(js) {
  return new Function(`
    const location = { href: "https://masest.co/dashboard#notifications", pathname: "/dashboard" };
    const safeUrl = (u) => {
      const s = String(u ?? "").trim();
      if (!s) return "";
      const schemeProbe = s.replace(/[\\u0000-\\u001F\\u007F\\s]+/g, "");
      if (/^(https?:|mailto:)/i.test(schemeProbe)) return s;
      if (/^[a-z][a-z0-9+.-]*:/i.test(schemeProbe)) return "#";
      return s;
    };
    ${extractConst(js, "DASH_TABS")}
    ${extractConst(js, "DASH_TAB_ALIASES")}
    ${extractFunction(js, "dashboardTabFromHash")}
    ${extractFunction(js, "defaultNotificationTarget")}
    ${extractFunction(js, "dashboardTargetWithoutTab")}
    ${extractFunction(js, "resolveNotificationTarget")}
    return { resolveNotificationTarget };
  `)();
}

test("dashboard notifications open same-page targets without reloading", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /function resolveNotificationTarget/, "notifications should normalize message/order/account targets");
  assert.match(js, /data-notif-link/, "notification rows should carry their navigation target");
  assert.match(js, /function openNotification/, "notification activation should be centralized");
  assert.match(js, /dashboardTabFromHash\(url\.hash\)/, "same-dashboard notification links should resolve through dashboard hash aliases");
  assert.doesNotMatch(extractFunction(js, "openDashboardTarget"), /['"]overview['"]/, "notification clicks should not fall back to Overview for missing or stale hashes");
  assert.match(js, /rail\.scrollTo\(\{\s*left:\s*Math\.max\(0, left\),\s*behavior:\s*'auto'\s*\}\)/, "overflowing mobile tab rails should reveal the active tab without scrolling the page");
  assert.match(js, /addEventListener\('keydown'/, "keyboard activation should match click activation");
});

test("legacy business notification hashes open business tools", () => {
  const { dashboardTabFromHash } = dashboardRouting(read("js/dashboard.js"));

  assert.equal(dashboardTabFromHash("#orders"), "orders");
  assert.equal(dashboardTabFromHash("/dashboard.html#messages"), "");
  assert.equal(dashboardTabFromHash("#programs"), "business");
  assert.equal(dashboardTabFromHash("bizPrograms"), "business");
  assert.equal(dashboardTabFromHash("bizInvoicing"), "business");
  assert.equal(dashboardTabFromHash("#unknown"), "");
  assert.equal(dashboardTabFromHash(""), "");
});

test("message notifications default to the messages panel", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /n\.type === 'message'[\s\S]+dashboard\.html#messages/, "message notifications should open the messages panel even when the API omits a link");
});

test("legacy bare dashboard notification links fall back to their type target", () => {
  const { resolveNotificationTarget } = notificationRouting(read("js/dashboard.js"));

  assert.equal(resolveNotificationTarget({ type: "account", link: "/dashboard.html" }), "dashboard.html#business");
  assert.equal(resolveNotificationTarget({ type: "message", link: "/dashboard.html" }), "dashboard.html#messages");
  assert.equal(resolveNotificationTarget({ type: "order", link: "https://masest.co/dashboard" }), "dashboard.html#orders");
  assert.equal(resolveNotificationTarget({ type: "account", link: "/dashboard.html#programs" }), "/dashboard.html#programs");
  assert.equal(resolveNotificationTarget({ type: "message", link: "javascript:alert(1)" }), "dashboard.html#messages");
});

test("dashboard loads a versioned dashboard controller", () => {
  const html = read("dashboard.html");

  assert.match(html, /<script type="module" src="js\/dashboard\.js\?v=\d{8}[a-z]"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="js\/dashboard\.js"><\/script>/);
});

test("account-only dashboard guides business setup instead of failing tabs", () => {
  const js = read("js/dashboard.js");

  assert.match(js, /Your account is ready\./, "dashboard should distinguish active user accounts from business verification");
  assert.match(js, /Business setup required/, "messages tab should explain business setup before company-scoped threads");
  assert.match(js, /Create a business profile before placing or tracking company orders/, "orders tab should not call company-scoped APIs before business setup");
  assert.match(js, /No business notifications yet/, "notifications tab should not show a load failure before business setup");
  assert.match(js, /No business profile yet/, "addresses tab should explain business setup before company-scoped addresses");
  assert.match(js, /Set up your business under .* to save a card on file/, "payment tab should name the account-only locked state");
  // Account-only users get the full "Business setup" steps card on the overview; the
  // action rail must NOT repeat that CTA (three identical CTAs read as noise), so the
  // rail's setup action is company-scoped only.
  assert.match(js, /openSteps\.length && ACCOUNT\?\.company/, "rail setup action is suppressed for account-only users (setup card is the single CTA)");
  assert.match(js, /ACCOUNT\?\.setup\?\.steps\?\.length \? '' :/, "overview banner defers to the setup steps card when present");
});

test("Stripe billing portal opens outside the dashboard shell", () => {
  const dashboard = read("js/dashboard.js");
  const business = read("js/business.js");

  assert.match(dashboard, /openReservedTab\(\)/, "dashboard should reserve a new tab before awaiting the portal URL");
  assert.match(business, /openReservedTab\(\)/, "business hub should reserve a new tab before awaiting the portal URL");
  assert.doesNotMatch(dashboard, /location\.href\s*=\s*url;/, "dashboard payment portal should not replace the account dashboard tab");
  assert.doesNotMatch(business, /window\.location\.assign\(out\.url\)/, "business payment portal should not replace the business hub tab");
});
