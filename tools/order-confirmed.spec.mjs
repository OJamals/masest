import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  await waitForHttpServer(`${BASE_URL}/order-confirmed.html`);
});

test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => {});
});

test("order confirmation shows session reference and clears the active cart", async ({ page }) => {
  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2 }));
  });

  await page.goto(`${BASE_URL}/order-confirmed.html?session_id=cs_test_1234567890abcdef`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator("#sessionSummary")).toContainText("1234567890abcdef");
  await expect(page.locator("#sessionSummary")).toContainText("We received checkout");
  await expect(page.locator("[data-cart-count]").first()).toHaveText("0");

  const storedCart = await page.evaluate(() => localStorage.getItem("masest_cart"));
  expect(storedCart).toBeNull();

  const promptBox = await page.locator(".confirmation-grid .route-card span").first().boundingBox();
  expect(promptBox?.width).toBeGreaterThan(160);
});
