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

test("product add-to-cart resolves the crhd commerce sku", async ({ page }) => {
  // Editorial id and the live catalog sku are both `crhd` (COMMERCE_ALIAS is empty in
  // product.html), so the buy button resolves the /api/products row directly — no remap.
  // NOTE: data/catalog.seed.json still describes a future `cr-hd` catalog redesign that is
  // NOT imported to the live DB; if that migration ever lands, the alias must be restored.
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          { sku: "crhd", name: "VertKleen CR HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
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

test("buy selector defaults to the 5 gallon pail and hides quote-only drums", async ({ page }) => {
  await page.route("**/api/products", async route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        {
          sku: "crhd",
          name: "VertKleen CR HD",
          mode: "buy",
          active: true,
          product_variants: [
            { vsku: "VK-CRHD-1", label: "1 gal", gallons: 1, price: 8.48, currency: "usd", active: true, sort: 1 },
            { vsku: "VK-CRHD-5", label: "5 gal", gallons: 5, price: 42.42, currency: "usd", active: true, sort: 3 },
            // 55 gal is quote-only (active:false) — must be filtered out of the buy selector.
            { vsku: "VK-CRHD-55", label: "55 gal drum", gallons: 55, price: 281.82, currency: "usd", active: false, sort: 4 },
          ],
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "networkidle" });

  await expect(page.locator("#pVol")).toHaveValue("VK-CRHD-5");
  await expect(page.locator("#pVol")).not.toContainText("55 gal drum");
  await expect(page.locator("#pUnitPrice")).toHaveText("$8.48/gal");
});

test("drum & tote reference block shows freight-quote CTA from static pricing", async ({ page }) => {
  await page.route("**/api/products", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "networkidle" });

  const drums = page.locator("#pDrums");
  await expect(drums).toBeVisible();
  await expect(drums).toContainText("55 gal drum");
  await expect(drums.getByRole("link", { name: /Request a freight quote/ })).toBeVisible();
});
