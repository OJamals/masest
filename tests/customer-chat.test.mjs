import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("js/customer-chat.js");
const chrome = read("js/main/chrome.js");
const css = read("css/customer-chat.css");
const messages = read("functions/api/account/messages.js");
const adminMessages = read("functions/api/admin/messages.js");
const phase5 = read("supabase/schema-phase5.sql");
const admin = read("js/admin.js");
let BASE_URL = "";

async function withServer(fn) {
  const staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

async function chatPage(browser, authModuleSource, {
  path = "/products.html",
  cart = {},
} = {}) {
  const context = await browser.newContext();
  await context.addInitScript((items) => {
    localStorage.setItem("masest_cart", JSON.stringify(items));
  }, cart);
  const page = await context.newPage();
  await page.route("**/js/auth.js*", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: authModuleSource,
  }));
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator(".customer-chat__toggle").waitFor();
  await page.waitForFunction(() => document.querySelector('link[data-masest-customer-chat="true"]')?.sheet);
  return { context, page };
}

test("customer chat is always mounted and gates sending on an auth session", () => {
  assert.match(chat, /id = "customerChat"/);
  assert.match(chat, /customer-chat__toggle/);
  assert.match(chat, /getToken/);
  assert.match(chat, /Sign up \/ Log in/);
  assert.match(chat, /masest:auth/);
  assert.match(chat, /masest:session-expired/);
  assert.equal((chat.match(/Request a quote with this context/g) || []).length, 2);
  assert.match(chat, /request-context\.js/);
});

test("customer chat has its own icon and a bounded popup layout", () => {
  assert.match(chat, /class="customer-chat__icon"/);
  assert.match(chat, /<svg[^>]*viewBox=/);
  assert.match(css, /\.customer-chat\s*\{[\s\S]*align-items:\s*end/);
  assert.match(css, /\.customer-chat__panel\s*\{[\s\S]*max-block-size:/);
  assert.match(css, /\.customer-chat__thread\s*\{[\s\S]*minmax\(0,/);
});

test("customer chat docking uses only explicitly registered obstructions", () => {
  assert.match(chrome, /data-customer-chat-obstruction/);
  assert.match(chrome, /masest:customer-chat-obstruction-change/);
  assert.match(chat, /\[data-customer-chat-obstruction\]/);
  assert.match(chat, /masest:customer-chat-obstruction-change/);
  assert.match(chat, /window\.addEventListener\("resize", scheduleDockAvoidance/);
  assert.doesNotMatch(chat, /querySelectorAll\(['"]a, button, input, select, textarea, summary/);
  assert.doesNotMatch(chat, /document\.addEventListener\("scroll", scheduleDockAvoidance/);
  assert.doesNotMatch(chat, /new MutationObserver/);
});

test("customer chat posts to the authenticated message thread and receives staff replies", () => {
  assert.match(chat, /api\("\/api\/account\/messages"/);
  assert.match(chat, /source: "customer_chat"/);
  assert.match(chat, /POLL_MS/);
  assert.match(messages, /body\.source === 'customer_chat'/);
  assert.match(messages, /source, read_by_user/);
  assert.match(admin, /source === 'customer_chat'/);
});

test("customer chat records open/closed presence and delegates conditional staff alerts", () => {
  assert.match(chat, /chat_presence/);
  assert.match(chat, /setChatPresence\(false\)/);
  assert.match(messages, /body\.action === 'chat_presence'/);
  assert.match(messages, /adminMessageAlertKind/);
  assert.match(adminMessages, /shouldEmailClosedChatReply/);
  assert.match(phase5, /support_chat_open boolean not null default false/);
  assert.match(phase5, /support_chat_seen_at timestamptz/);
});

test("logged-out visitors always see chat and get a sign-up/login link", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      const toggle = page.locator(".customer-chat__toggle");
      await toggle.waitFor();
      assert.equal(await toggle.isVisible(), true);
      await toggle.click();
      const link = page.locator('.customer-chat__guest a[href="account.html"]');
      await link.waitFor();
      assert.equal(await link.textContent(), "Sign up / Log in");
      const quoteLink = page.locator(".customer-chat__guest .customer-chat__quote-link");
      await quoteLink.waitFor();
      assert.equal(await quoteLink.textContent(), "Request a quote with this context");
      assert.equal(await quoteLink.getAttribute("class"), "customer-chat__quote-link");
      assert.equal(await toggle.locator("svg.customer-chat__icon").count(), 1);
      const panel = page.locator(".customer-chat__panel");
      const panelBox = await panel.boundingBox();
      assert.ok(panelBox && panelBox.height < 460, `panel height ${panelBox?.height}`);
      const headerBox = await page.locator(".customer-chat__header").boundingBox();
      assert.ok(panelBox && headerBox && headerBox.y - panelBox.y < 8, `header offset ${headerBox?.y - panelBox?.y}`);
      await page.locator(".customer-chat__guest").evaluate((guest) => { guest.hidden = true; });
      await page.locator(".customer-chat__thread").evaluate((thread) => { thread.hidden = false; });
      const messages = page.locator(".customer-chat__messages");
      await messages.evaluate((list) => {
        for (let i = 0; i < 30; i += 1) {
          const item = document.createElement("p");
          item.textContent = `Message ${i}`;
          list.append(item);
        }
      });
      await messages.hover();
      await page.mouse.wheel(0, 360);
      const scrollState = await messages.evaluate((list) => ({ scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, overflowY: getComputedStyle(list).overflowY }));
      assert.ok(scrollState.scrollTop > 0, `message list should scroll under pointer: ${JSON.stringify(scrollState)}`);
    } finally {
      await browser.close();
    }
  });
});

test("guest and authenticated chat quote links carry bounded page and cart context", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const guestAuth = `
      export async function getToken() { return null; }
      export async function me() { return null; }
      export async function api() { return { messages: [] }; }
    `;
    const authenticatedAuth = `
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false }; }
      export async function api() { return { messages: [] }; }
    `;
    try {
      const guest = await chatPage(browser, guestAuth, {
        path: "/products/hcr.html?email=buyer%40example.com&message=private#history",
        cart: { "VK-HCR-1G": 2, "VK-LAM3-5G": 1 },
      });
      await guest.page.locator(".customer-chat__toggle").click();
      const guestQuote = guest.page.locator(".customer-chat__guest .customer-chat__quote-link");
      await guest.page.waitForFunction(() => document.querySelector(".customer-chat__guest .customer-chat__quote-link")?.search.includes("source=customer_chat"));
      const guestUrl = new URL(await guestQuote.getAttribute("href"), BASE_URL);
      assert.equal(guestUrl.pathname, "/contact.html");
      assert.equal(guestUrl.searchParams.get("product"), "hcr");
      assert.equal(guestUrl.searchParams.get("path"), "/products/hcr.html");
      assert.deepEqual(guestUrl.searchParams.getAll("cart"), ["VK-HCR-1G:2", "VK-LAM3-5G:1"]);
      assert.equal(guestUrl.searchParams.has("email"), false);
      assert.equal(guestUrl.searchParams.has("message"), false);
      assert.equal(guestUrl.searchParams.has("history"), false);
      await guest.page.evaluate(async () => {
        const cart = await import("/js/cart.js?test=context-update");
        cart.add("VK-NEUTRAL-1G", 1);
      });
      await guest.page.waitForFunction(() => (
        new URL(document.querySelector(".customer-chat__guest .customer-chat__quote-link").href)
          .searchParams.getAll("cart").includes("VK-NEUTRAL-1G:1")
      ));
      await guestQuote.click();
      assert.equal(new URL(guest.page.url()).pathname, "/contact.html");
      await guest.page.goBack({ waitUntil: "domcontentloaded" });
      assert.equal(new URL(guest.page.url()).pathname, "/products/hcr.html");
      await guest.context.close();

      const authenticated = await chatPage(browser, authenticatedAuth);
      await authenticated.page.setViewportSize({ width: 320, height: 568 });
      await authenticated.page.locator(".customer-chat__toggle").click();
      const authQuote = authenticated.page.locator(".customer-chat__thread .customer-chat__quote-link");
      await authQuote.waitFor();
      assert.equal(await authQuote.isVisible(), true);
      assert.equal(await authenticated.page.locator(".customer-chat__form .btn-primary").textContent(), "Send");
      assert.equal(await authQuote.getAttribute("class"), "customer-chat__quote-link");
      for (const height of [568, 360, 320]) {
        await authenticated.page.setViewportSize({ width: 320, height });
        await authenticated.page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const authenticatedBounds = await authenticated.page.evaluate(() => {
          const panel = document.querySelector(".customer-chat__panel").getBoundingClientRect();
          const form = document.querySelector(".customer-chat__form").getBoundingClientRect();
          const quote = document.querySelector(".customer-chat__thread .customer-chat__quote-link").getBoundingClientRect();
          return {
            viewportHeight: window.innerHeight,
            panelTop: panel.top,
            panelBottom: panel.bottom,
            formBottom: form.bottom,
            quoteBottom: quote.bottom,
          };
        });
        assert.ok(
          authenticatedBounds.panelTop >= -1
            && authenticatedBounds.panelBottom <= authenticatedBounds.viewportHeight + 1,
          `authenticated panel clips viewport at 320x${height}: ${JSON.stringify(authenticatedBounds)}`,
        );
        assert.ok(
          authenticatedBounds.formBottom <= authenticatedBounds.panelBottom + 1,
          `authenticated form clips panel at 320x${height}: ${JSON.stringify(authenticatedBounds)}`,
        );
        assert.ok(
          authenticatedBounds.quoteBottom <= authenticatedBounds.panelBottom + 1,
          `authenticated quote link clips panel at 320x${height}: ${JSON.stringify(authenticatedBounds)}`,
        );
      }
      await authenticated.context.close();
    } finally {
      await browser.close();
    }
  });
});

test("customer chat places and restores focus for every open path", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const guestAuth = `
      export async function getToken() { return null; }
      export async function me() { return null; }
      export async function api() { return { messages: [] }; }
    `;
    const authenticatedAuth = `
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false }; }
      export async function api() { return { messages: [] }; }
    `;
    const failedAuth = `
      export async function getToken() { throw new Error("auth lookup failed"); }
      export async function me() { return null; }
      export async function api() { return { messages: [] }; }
    `;
    try {
      const guest = await chatPage(browser, guestAuth);
      const guestToggle = guest.page.locator(".customer-chat__toggle");
      const guestAction = guest.page.locator(".customer-chat__guest .btn-primary");
      await guestToggle.focus();
      await guest.page.keyboard.press("Enter");
      await guest.page.waitForFunction(() => document.activeElement?.matches(".customer-chat__guest .btn-primary"));
      assert.deepEqual(await guestAction.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          active: document.activeElement === element,
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      }), { active: true, focusVisible: true, outlineStyle: "solid", outlineWidth: "2px" });

      await guest.page.locator(".customer-chat__close").click();
      assert.equal(await guestToggle.evaluate((element) => document.activeElement === element), true);

      await guest.page.keyboard.press("Enter");
      await guest.page.waitForFunction(() => document.activeElement?.matches(".customer-chat__guest .btn-primary"));
      assert.equal(await guestAction.evaluate((element) => document.activeElement === element), true);
      assert.equal(await guest.page.locator(".customer-chat__guest .customer-chat__quote-link").isVisible(), true);

      await guest.page.keyboard.press("Escape");
      assert.equal(await guestToggle.evaluate((element) => document.activeElement === element), true);
      await guest.context.close();

      const authenticated = await chatPage(browser, authenticatedAuth);
      const textarea = authenticated.page.locator("#customerChatBody");
      await authenticated.page.locator(".customer-chat__toggle").focus();
      await authenticated.page.keyboard.press("Enter");
      await authenticated.page.waitForFunction(() => document.activeElement?.id === "customerChatBody");
      assert.equal(await authenticated.page.locator(".customer-chat__thread .customer-chat__quote-link").isVisible(), true);
      assert.deepEqual(await textarea.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          active: document.activeElement === element,
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      }), { active: true, focusVisible: true, outlineStyle: "solid", outlineWidth: "2px" });
      await authenticated.context.close();

      const failed = await chatPage(browser, failedAuth);
      const failedGuestAction = failed.page.locator(".customer-chat__guest .btn-primary");
      await failed.page.locator(".customer-chat__toggle").focus();
      await failed.page.keyboard.press("Enter");
      await failed.page.waitForFunction(() => document.activeElement?.matches(".customer-chat__guest .btn-primary"));
      assert.equal(await failedGuestAction.evaluate((element) => document.activeElement === element), true);
      await failed.context.close();
    } finally {
      await browser.close();
    }
  });
});
