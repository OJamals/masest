import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4296;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/index.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => {});
});

test("info toast renders politely in a shared live region and auto-dismisses", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });

  await page.evaluate(async (base) => {
    const { toast } = await import(`${base}/js/util.js`);
    toast("Hello from a toast", { duration: 400 });
  }, BASE_URL);

  const region = page.locator(".toast-region");
  await expect(region).toHaveAttribute("aria-live", "polite");

  const node = page.locator(".toast");
  await expect(node).toBeVisible();
  await expect(node).toHaveAttribute("role", "status");
  await expect(node.locator(".toast-msg")).toHaveText("Hello from a toast");

  await expect(node).toHaveCount(0, { timeout: 2000 });
});

test("error toast announces assertively and dismisses via the close button", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });

  await page.evaluate(async (base) => {
    const { toast } = await import(`${base}/js/util.js`);
    toast("Something failed", { variant: "error", duration: 0 }); // duration 0 => persists
  }, BASE_URL);

  const node = page.locator(".toast.toast-error");
  await expect(node).toBeVisible();
  await expect(node).toHaveAttribute("role", "alert");

  await page.locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 2000 });
});

test("toast preserves newlines in multi-line messages", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });

  await page.evaluate(async (base) => {
    const { toast } = await import(`${base}/js/util.js`);
    toast("Line one\nLine two", { duration: 0 });
  }, BASE_URL);

  const msg = page.locator(".toast-msg");
  await expect(msg).toBeVisible();
  const text = await msg.evaluate((el) => el.textContent);
  expect(text).toBe("Line one\nLine two");
  const whiteSpace = await msg.evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(whiteSpace).toBe("pre-line");
});
