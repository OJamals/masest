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
const supportPublisher = read("functions/_lib/support-message-publisher.js");
const supportEmail = read("functions/_lib/support-email.js");
const supportDelivery = read("functions/_lib/support-delivery.js");
const supportEmailDelivery = read("functions/_lib/support-email-delivery.js");
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
  await page.locator(".customer-chat__toggle").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.querySelector('link[data-masest-customer-chat="true"]')?.sheet);
  return { context, page };
}

test("customer chat is always mounted and gates sending on an auth session", () => {
  assert.match(chat, /id = "customerChat"/);
  assert.match(chat, /customer-chat__toggle/);
  assert.match(chat, /customer-chat\.css\?v=\d{8}[a-z]/);
  assert.match(chat, /getToken/);
  assert.match(chat, /Sign up \/ Log in/);
  assert.match(chat, /masest:auth/);
  assert.match(chat, /masest:session-expired/);
  assert.equal((chat.match(/Get a quote with this info/g) || []).length, 2);
  assert.match(chat, /request-context\.js/);
});

test("dashboard restores floating chat after leaving the full message inbox", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const authModule = `
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false, profile: { full_name: "Test Buyer" } }; }
      export async function logout() {}
      export async function orders() { return { orders: [] }; }
      export async function api() { return { messages: [], unread: 0 }; }
      export async function updatePassword() {}
    `;
    try {
      const { context, page } = await chatPage(browser, authModule, {
        path: "/dashboard.html#messages",
      });
      const shell = page.locator("#customerChat");
      assert.equal(await shell.evaluate((element) => element.hidden), true);

      await page.locator('.dash-tab[data-tab="overview"]').click();
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      assert.equal(new URL(page.url()).hash, "#overview");
      assert.equal(await shell.evaluate((element) => element.hidden), false);
      await context.close();
    } finally {
      await browser.close();
    }
  });
});

test("order chat requests emitted during auth startup open after chat mounts", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/js/auth.js*", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        let ready = false;
        export async function getToken() {
          if (!ready) await new Promise((resolve) => {
            window.__releaseChatAuth = () => { ready = true; resolve(); };
          });
          return "test-token";
        }
        export async function me() { return { can_admin: false }; }
        export async function api() { return { messages: [], order_scope: { id: "order-race", reference: "MST-RACE" } }; }
      `,
    }));
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof window.__releaseChatAuth === "function");
      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent("masest:open-support-order", {
          detail: { order: { id: "order-race", reference: "MST-RACE", status: "paid" } },
        }));
        window.__releaseChatAuth();
      });

      await page.locator(".customer-chat__panel").waitFor({ state: "visible", timeout: 3_000 });
      assert.equal(await page.locator("[data-customer-chat-order]").textContent(), "order MST-RACE");
    } finally {
      await context.close();
      await browser.close();
    }
  });
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
  assert.match(messages, /dependencies\.publishSupportMessage \|\| publishSupportMessage/);
  assert.match(messages, /publication = await publishMessage\(/);
  assert.match(supportPublisher, /appendSupportMessage/);
  assert.match(messages, /source,/);
  assert.match(admin, /source === 'customer_chat'/);
});

test("customer chat uses the active buyer ticket contract", () => {
  assert.match(chat, /ticket_id/);
  assert.match(chat, /start_ticket/);
  assert.match(chat, /customer-chat__ticket/);
  assert.match(chat, /customer-chat__new-ticket/);
  assert.doesNotMatch(chat, /assigned_to/);
  assert.doesNotMatch(chat, /priority/);
});

test("customer chat replies to the active ticket and starts a deliberate new issue without reusing it", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const context = await browser.newContext();
    const page = await context.newPage();
    const authModule = `
      const calls = [];
      window.__chatApiCalls = calls;
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false }; }
      export async function api(path, options = {}) {
        calls.push({ path, options });
        if (options.method === "POST") return { ticket_id: "ticket-active", ticket: { id: "ticket-active", display_number: "MAS-000001", status: "open" } };
        return { ticket: { id: "ticket-active", display_number: "MAS-000001", status: "open" }, messages: [], has_more: false, next_message_cursor: null, order_scope: null };
      }
    `;
    await page.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authModule }));
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.locator(".customer-chat__toggle").click();
      await page.locator("#customerChatBody").fill("A reply on this issue");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.waitForFunction(() => window.__chatApiCalls.some((call) => call.options.body?.body === "A reply on this issue"));
      const reply = await page.evaluate(() => window.__chatApiCalls.find((call) => call.options.body?.body === "A reply on this issue"));
      assert.deepEqual(reply.options.body, { body: "A reply on this issue", order_id: null, source: "customer_chat", ticket_id: "ticket-active" });
      await page.locator("[data-customer-chat-new-ticket]").click();
      await page.locator("#customerChatSubject").fill("A separate issue");
      await page.locator("#customerChatBody").fill("Start a separate support issue");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.waitForFunction(() => window.__chatApiCalls.some((call) => call.options.body?.body === "Start a separate support issue"));
      const fresh = await page.evaluate(() => window.__chatApiCalls.find((call) => call.options.body?.body === "Start a separate support issue"));
      assert.deepEqual(fresh.options.body, { action: "start_ticket", body: "Start a separate support issue", category: "general", order_id: null, source: "customer_chat", subject: "A separate issue" });
      assert.equal(Object.hasOwn(fresh.options.body, "ticket_id"), false);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("customer chat isolates order drafts and settles sends across same-context refreshes", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const authModule = `
      const calls = [];
      window.__chatDraftCalls = calls;
      window.__chatDraftSettled = [];
      const orders = {
        A: { id: "order-a", reference: "MST-A" },
        B: { id: "order-b", reference: "MST-B" },
      };
      const tickets = {
        A: { id: "ticket-a", display_number: "MAS-000001", status: "open" },
        B: { id: "ticket-b", display_number: "MAS-000002", status: "open" },
      };
      let releaseOrderB;
      const orderBGate = new Promise((resolve) => { releaseOrderB = resolve; });
      let orderBLoads = 0;
      window.__releaseOrderB = releaseOrderB;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false }; }
      export async function api(path, options = {}) {
        calls.push({ path, options });
        if (options.method === "POST") {
          if (["Send pending", "Create pending"].includes(options.body?.body)) await wait(220);
          const key = options.body?.order_id === "order-b" ? "B" : "A";
          window.__chatDraftSettled.push(options.body?.body || "");
          return { ticket_id: tickets[key].id, ticket: tickets[key] };
        }
        const key = new URL(path, "http://fixture").searchParams.get("order_id") === "order-b" ? "B" : "A";
        if (key === "B" && orderBLoads++ === 0) await orderBGate;
        return { ticket: tickets[key], messages: [{ id: "message-" + key, sender_role: "staff", body: "A complete staff answer for order " + key, created_at: "2026-09-06T12:00:00Z" }], has_more: false, next_message_cursor: null, order_scope: orders[key] };
      }
    `;
    await page.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authModule }));
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.locator(".customer-chat__toggle").click();
      await page.locator('[data-customer-chat-ticket-number]').waitFor();
      await page.locator("#customerChatBody").fill("Draft for order A");
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("masest:open-support-order", { detail: { order: { id: "order-b", reference: "MST-B" } } })));
      assert.doesNotMatch(await page.locator(".customer-chat__messages").textContent(), /complete staff answer for order A/);
      assert.match(await page.locator(".customer-chat__messages").textContent(), /Loading messages/);
      await page.evaluate(() => window.__releaseOrderB());
      await page.waitForFunction(() => document.querySelector("[data-customer-chat-ticket-number]")?.textContent === "MAS-000002");
      assert.equal(await page.locator("#customerChatBody").inputValue(), "", "order B must not inherit order A's draft");
      await page.locator("#customerChatBody").fill("Draft for order B");
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("masest:open-support-order", { detail: { order: { id: "order-a", reference: "MST-A" } } })));
      await page.waitForFunction(() => document.querySelector("[data-customer-chat-ticket-number]")?.textContent === "MAS-000001");
      assert.equal(await page.locator("#customerChatBody").inputValue(), "Draft for order A", "returning to order A must restore only its draft");
      await page.locator("#customerChatBody").fill("Send pending");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.evaluate(() => document.dispatchEvent(new Event("masest:auth")));
      await page.locator("#customerChatBody").fill("Newer edit");
      await page.waitForFunction(() => window.__chatDraftSettled.includes("Send pending") && document.querySelector("#customerChatBody")?.value === "Newer edit");
      const pending = await page.evaluate(() => window.__chatDraftCalls.find((call) => call.options.method === "POST" && call.options.body?.body === "Send pending"));
      assert.equal(pending.options.body.ticket_id, "ticket-a");
      assert.equal(pending.options.body.order_id, "order-a");

      await page.locator("#customerChatBody").fill("Trimmed widget send  ");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.waitForFunction(() => window.__chatDraftSettled.includes("Trimmed widget send") && document.querySelector("#customerChatBody")?.value === "");

      await page.locator("[data-customer-chat-new-ticket]").click();
      await page.locator("#customerChatSubject").fill("Create a fresh issue");
      await page.locator("#customerChatBody").fill("Create pending");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.locator("#customerChatBody").fill("Newer create edit");
      await page.waitForFunction(() => window.__chatDraftSettled.includes("Create pending") && document.querySelector("#customerChatBody")?.value === "Newer create edit");
      await page.locator(".customer-chat__form [type=submit]").click();
      await page.waitForFunction(() => window.__chatDraftSettled.includes("Newer create edit") && document.querySelector("#customerChatBody")?.value === "");
      await page.locator("[data-customer-chat-new-ticket]").click();
      assert.equal(await page.locator("#customerChatBody").inputValue(), "", "re-entering New issue must not resurrect the remapped sent draft");
      await page.locator("[data-customer-chat-new-ticket]").click();

      await page.locator("#customerChatBody").fill("Capture the submit destination");
      await page.evaluate(() => {
        document.querySelector(".customer-chat__form").requestSubmit();
        document.dispatchEvent(new CustomEvent("masest:open-support-order", { detail: { order: { id: "order-b", reference: "MST-B" } } }));
      });
      await page.waitForFunction(() => window.__chatDraftCalls.some((call) => call.options.method === "POST" && call.options.body?.body === "Capture the submit destination"));
      const captured = await page.evaluate(() => window.__chatDraftCalls.find((call) => call.options.method === "POST" && call.options.body?.body === "Capture the submit destination"));
      assert.equal(captured.options.body.ticket_id, "ticket-a", "the submit uses the ticket captured before its first await");
      assert.equal(captured.options.body.order_id, "order-a", "the submit uses the order captured before its first await");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("customer chat records presence and delegates counterpart email to shared support delivery", () => {
  assert.match(chat, /chat_presence/);
  assert.match(chat, /setChatPresence\(false\)/);
  assert.match(messages, /body\.action === 'chat_presence'/);
  assert.match(messages, /publishSupportMessage/);
  assert.match(adminMessages, /publishSupportMessage/);
  assert.match(supportPublisher, /attemptSupportMessageDelivery/);
  assert.doesNotMatch(supportPublisher, /deliverSupportMessageEmail/);
  assert.match(supportDelivery, /processClaimedIntegrationEffect/);
  assert.match(supportEmail, /attemptSupportMessageDelivery/);
  assert.match(supportEmailDelivery, /adminMessageAlertKind/);
  assert.match(supportEmailDelivery, /shouldEmailSupportRecipient/);
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
      assert.equal(await quoteLink.textContent(), "Get a quote with this info");
      assert.equal(await quoteLink.getAttribute("class"), "customer-chat__quote-link");
      assert.equal(await toggle.locator("svg.customer-chat__icon").count(), 1);
      assert.deepEqual(await page.locator(".customer-chat__thread").evaluate((thread) => ({
        hidden: thread.hidden,
        display: getComputedStyle(thread).display,
        height: thread.getBoundingClientRect().height,
      })), { hidden: true, display: "none", height: 0 });
      assert.equal(
        await page.locator(".customer-chat__close svg").evaluate((icon) => getComputedStyle(icon).stroke),
        "rgb(255, 255, 255)",
      );
      const panel = page.locator(".customer-chat__panel");
      const panelBox = await panel.boundingBox();
      assert.ok(panelBox && panelBox.height < 320, `guest panel height ${panelBox?.height}`);
      const headerBox = await page.locator(".customer-chat__header").boundingBox();
      assert.ok(panelBox && headerBox && headerBox.y - panelBox.y < 8, `header offset ${headerBox?.y - panelBox?.y}`);
      const actionBox = await link.boundingBox();
      const quoteBox = await quoteLink.boundingBox();
      assert.ok(
        actionBox && quoteBox && quoteBox.y >= actionBox.y + actionBox.height,
        `guest actions should stack: ${JSON.stringify({ actionBox, quoteBox })}`,
      );
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

test("customer chat close paths remove the hidden panel from layout", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const authenticatedAuth = `
      export async function getToken() { return "test-token"; }
      export async function me() { return { can_admin: false }; }
      export async function api() { return { messages: [] }; }
    `;
    try {
      const { context, page } = await chatPage(browser, authenticatedAuth);
      const toggle = page.locator(".customer-chat__toggle");
      const close = page.locator(".customer-chat__close");
      const panel = page.locator(".customer-chat__panel");

      const assertClosed = async () => {
        assert.deepEqual(await panel.evaluate((element) => ({
          hidden: element.hidden,
          display: getComputedStyle(element).display,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })), { hidden: true, display: "none", width: 0, height: 0 });
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      };

      await toggle.click();
      assert.equal(await panel.isVisible(), true);
      await close.click();
      await assertClosed();

      await toggle.click();
      assert.equal(await panel.isVisible(), true);
      await toggle.click();
      await assertClosed();
      await context.close();
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
