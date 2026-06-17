import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4184;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/product.html?id=crhd`).catch(() => null);
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

test("product add-to-cart gives confirmation and cart route", async ({ page }) => {
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          { sku: "crhd", name: "VertKleen CRHD", mode: "buy", active: true, price: 12.5, currency: "usd" },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Add to cart/ }).click();

  await expect(page.getByText("Added to cart")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review cart" })).toHaveAttribute("href", "cart.html");
  await expect(page.locator("[data-cart-count]")).toHaveText("1");
});
