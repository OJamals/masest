import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4180;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/cart.html`).catch(() => null);
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.MASEST_ENABLE_LOCAL_API = true;
  });
});

test("cart shows server catalog prices and estimated subtotal", async ({ page }) => {
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          { sku: "crhd", name: "VertKleen CRHD", mode: "buy", active: true, price: 12.5, currency: "usd" },
          { sku: "hcr", name: "VertKleen HCR", mode: "buy", active: true, price: 10, currency: "usd" },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2, hcr: 1 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByText("Estimated product subtotal")).toBeVisible();
  await expect(page.getByText("$35.00")).toBeVisible();
  await expect(page.getByText("$12.50 each")).toBeVisible();
  await expect(page.getByText("$10.00 each")).toBeVisible();

  await page.locator('input[data-qty="crhd"]').fill("3");
  await expect(page.getByText("$47.50")).toBeVisible();
});

test("cart accepts flattened connector variant rows", async ({ page }) => {
  await page.route("**/api/products", async route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        {
          sku: "crhd-5",
          vsku: "crhd-5",
          label: "5 gal pail",
          gallons: 5,
          price: 125,
          currency: "usd",
          active: true,
          mode: "buy",
          name: "VertKleen CRHD",
          products: { sku: "crhd", name: "VertKleen CRHD", mode: "buy", active: true },
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ "crhd-5": 2 }));
  });
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByText("VertKleen CRHD - 5 gal pail")).toBeVisible();
  await expect(page.getByText("$125.00 each")).toBeVisible();
  await expect(page.getByRole("button", { name: "Card / ACH Checkout" })).toBeEnabled();
  await expect(page.locator("#shipEstOut")).toContainText("10 gal");
});

test("cart disables direct checkout when bulk freight items are present", async ({ page }) => {
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          { sku: "crhd", name: "VertKleen CRHD", mode: "buy", active: true, price: 12.5, currency: "usd" },
          { sku: "lam3", name: "VertKleen LAM3", mode: "quote", active: true, price: null, currency: "usd" },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ crhd: 1, lam3: 1 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByText("Quote required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Card / ACH Checkout" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Use NET Terms" })).toBeDisabled();
  await expect(page.locator("#cartStatus")).toContainText("Remove bulk freight items");

  const quoteHref = await page.getByRole("link", { name: "Send Quote Request" }).getAttribute("href");
  const quoteUrl = new URL(quoteHref, BASE_URL);
  expect(quoteUrl.searchParams.get("type")).toBe("quote");
  expect(quoteUrl.searchParams.get("cart")).toBe("crhd:1,lam3:1");
  expect(quoteUrl.searchParams.get("message")).toContain("VertKleen CR-HD x 1");
  expect(quoteUrl.searchParams.get("message")).toContain("VertKleen LAM3 x 1");
});

test("cart quote link reflects edited quantities before blur", async ({ page }) => {
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

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ crhd: 1 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.locator("#checkoutEmail").fill("buyer@example.com");
  await page.locator('input[data-qty="crhd"]').fill("4");

  const quoteHref = await page.getByRole("link", { name: "Send Quote Request" }).getAttribute("href");
  const quoteUrl = new URL(quoteHref, BASE_URL);
  expect(quoteUrl.searchParams.get("cart")).toBe("crhd:4");
  expect(quoteUrl.searchParams.get("email")).toBe("buyer@example.com");
  expect(quoteUrl.searchParams.get("message")).toContain("VertKleen CR-HD x 4");
});

test("cart re-enables checkout after removing bulk freight items", async ({ page }) => {
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: [
          { sku: "crhd", name: "VertKleen CRHD", mode: "buy", active: true, price: 12.5, currency: "usd" },
          { sku: "lam3", name: "VertKleen LAM3", mode: "quote", active: true, price: null, currency: "usd" },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("masest_cart", JSON.stringify({ crhd: 1, lam3: 1 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: "Card / ACH Checkout" })).toBeDisabled();
  await page.locator('[data-remove="lam3"]').click();

  await expect(page.getByRole("button", { name: "Card / ACH Checkout" })).toBeEnabled();
  await expect(page.locator("#cartStatus")).toContainText("Cart totals are confirmed");

  const quoteHref = await page.getByRole("link", { name: "Send Quote Request" }).getAttribute("href");
  const quoteUrl = new URL(quoteHref, BASE_URL);
  expect(quoteUrl.searchParams.get("cart")).toBe("crhd:1");
  expect(quoteUrl.searchParams.get("message")).not.toContain("LAM3");
});
