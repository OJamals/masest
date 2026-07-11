import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import test from "node:test";
import { chromium } from "playwright";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("js/customer-chat.js");
const messages = read("functions/api/account/messages.js");
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

test("customer chat posts to the authenticated message thread and receives staff replies", () => {
  assert.match(chat, /api\("\/api\/account\/messages"/);
  assert.match(chat, /source: "customer_chat"/);
  assert.match(chat, /POLL_MS/);
  assert.match(messages, /body\.source === 'customer_chat'/);
  assert.match(messages, /source, read_by_user/);
  assert.match(admin, /source === 'customer_chat'/);
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
    } finally {
      await browser.close();
    }
  });
});
