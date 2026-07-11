import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import test from "node:test";
import { chromium } from "playwright";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("js/customer-chat.js");
const css = read("css/customer-chat.css");
const messages = read("functions/api/account/messages.js");
const adminMessages = read("functions/api/admin/messages.js");
const phase5 = read("supabase/schema-phase5.sql");
const admin = read("js/admin.js");
const PORT = 4194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function serverReady() {
  return new Promise((resolve) => {
    const request = get(`${BASE_URL}/products.html`, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => { request.destroy(); resolve(false); });
  });
}

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: new URL("..", import.meta.url), stdio: "ignore" });
  const exited = once(server, "exit");
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !await serverReady()) await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
}

test("customer chat is always mounted and gates sending on an auth session", () => {
  assert.match(chat, /id = "customerChat"/);
  assert.match(chat, /customer-chat__toggle/);
  assert.match(chat, /getToken/);
  assert.match(chat, /Sign up \/ Log in/);
  assert.match(chat, /masest:auth/);
  assert.match(chat, /masest:session-expired/);
});

test("customer chat has its own icon and a bounded popup layout", () => {
  assert.match(chat, /class="customer-chat__icon"/);
  assert.match(chat, /<svg[^>]*viewBox=/);
  assert.match(css, /\.customer-chat\s*\{[\s\S]*align-items:\s*end/);
  assert.match(css, /\.customer-chat__panel\s*\{[\s\S]*max-block-size:/);
  assert.match(css, /\.customer-chat__thread\s*\{[\s\S]*minmax\(0,/);
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
});

test("logged-out visitors always see chat and get a sign-up/login link", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
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
