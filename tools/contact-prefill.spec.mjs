import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4195;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/contact.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([
    exitedOnce,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

test("contact form pre-fills quote message from cart handoff", async ({ page }) => {
  const message = "Cart quote request: VertKleen CR-HD x 1; VertKleen LAM3 x 1.";
  await page.goto(`${BASE_URL}/contact.html?type=quote&email=buyer%40example.com&message=${encodeURIComponent(message)}`, {
    waitUntil: "networkidle",
  });

  await expect(page.locator('[name="type"]')).toHaveValue("quote");
  await expect(page.locator("#fEmail")).toHaveValue("buyer@example.com");
  await expect(page.locator('[name="message"]')).toHaveValue(message);
});
