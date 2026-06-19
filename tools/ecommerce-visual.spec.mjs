import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/products.html`).catch(() => null);
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

test("catalog keeps replacement checker and product shelf within a quick scan", async ({ page }) => {
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

  const swap = await page.locator("#swap").boundingBox();
  const catalog = await page.locator("#catalog").boundingBox();

  expect(swap.height).toBeLessThan(880);
  expect(catalog.y).toBeLessThan(1700);
});

test("product detail shows next decision without an oversized hero", async ({ page }) => {
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "cr-hd",
        name: "VertKleen CRHD",
        mode: "buy",
        active: true,
        product_variants: [
          { vsku: "cr-hd-5", label: "5 gal pail", price: 125, currency: "usd", active: true, sort: 1 },
        ],
      }],
    }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "networkidle" });

  const hero = await page.locator(".page-hero").boundingBox();
  const mediaTop = await page.locator("#pMediaSection").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top + window.scrollY;
  });

  expect(hero.height).toBeLessThan(800);
  expect(mediaTop).toBeLessThan(1900);
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();
});
