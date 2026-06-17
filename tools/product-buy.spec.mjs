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

test("product buy selector defaults to the 55 gallon bulk price", async ({ page }) => {
  await page.route("**/api/products", async route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        {
          sku: "crhd",
          name: "VertKleen CRHD",
          mode: "buy",
          active: true,
          product_variants: [
            { vsku: "crhd-5", label: "5 gal pail", gallons: 5, price: 125, currency: "usd", active: true, sort: 1 },
            { vsku: "crhd-55", label: "55 gal drum", gallons: 55, price: 899.25, currency: "usd", active: true, sort: 2 },
          ],
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "networkidle" });

  await expect(page.locator("#pVol")).toHaveValue("crhd-55");
  await expect(page.locator("#pVol")).toContainText("55 gal drum · $899.25 · $16.35/gal");
  await expect(page.locator("#pUnitPrice")).toHaveText("$16.35/gal");

  await page.locator("#pVol").selectOption("crhd-5");
  await expect(page.locator("#pUnitPrice")).toHaveText("$25/gal");
});
