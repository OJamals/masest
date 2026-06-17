import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      try {
        const response = await fetch(`${BASE_URL}/cart.html`);
        if (response.ok) break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

async function routeProducts(page, products) {
  await page.route("**/api/products", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ products })
  }));
}

test("catalog stays quote-only when commerce metadata is unavailable", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

      assert.equal(await page.locator("[data-cart-add]").count(), 0);
        assert.equal(await page.locator(".shop-card-quote").count(), 0);

      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#checkoutPay").isDisabled(), true);
      assert.equal(await page.locator("#checkoutNet").isDisabled(), true);
    } finally {
      await browser.close();
    }
  });
});

test("product catalog shows programs, distributor CTA, and 55-gallon price per gallon", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page, [
        {
          sku: "hcr",
          active: true,
          mode: "buy",
          product_variants: [
            { vsku: "hcr-5", label: "5 gal pail", gallons: 5, price: 175, currency: "usd", active: true, sort: 1 },
            { vsku: "hcr-55", label: "55 gal drum", gallons: 55, price: 1375, currency: "usd", active: true, sort: 2 },
          ],
        },
      ]);

      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

      assert.equal(await page.locator(".shop-card-quote").count(), 0);
      await page.getByRole("link", { name: /Compare programs/i }).waitFor();
      await page.getByRole("link", { name: /Become a distributor/i }).waitFor();
      await page.getByText("$25/gal").waitFor();
      assert.equal(await page.getByText("at 55 gal").count(), 0);
    } finally {
      await browser.close();
    }
  });
});

test("priced buy-mode products can be added to the cart", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page, [
        { sku: "hcr", active: true, mode: "buy", price: 42, currency: "usd" },
        { sku: "cr", active: true, mode: "quote", price: null, currency: "usd" }
      ]);

      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
      await page.locator('[data-cart-add="hcr"]').click();
      await page.waitForFunction(() => localStorage.getItem("masest_cart")?.includes("hcr"));

      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".cart-line").count(), 1);
      assert.equal(await page.locator("#checkoutPay").isDisabled(), false);
      assert.equal(await page.locator("#checkoutNet").isDisabled(), false);

      await page.locator("[data-remove]").click();
      assert.equal(await page.locator("#checkoutPay").isDisabled(), true);
      assert.equal(await page.locator("#checkoutNet").isDisabled(), true);
    } finally {
      await browser.close();
    }
  });
});

test("cart page explains quote fallback when checkout rejects a SKU", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page, [
        { sku: "hcr", active: true, mode: "buy", price: 42, currency: "usd" }
      ]);
      await page.route("**/api/checkout", route => route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "not_purchasable",
          message: "These SKUs are quote-only or not yet priced.",
          skus: ["hcr"]
        })
      }));

      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
      await page.locator('[data-cart-add="hcr"]').click();
      await page.waitForFunction(() => localStorage.getItem("masest_cart")?.includes("hcr"));
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "networkidle" });
      await page.locator("#checkoutPay").click();

      await assert.doesNotReject(async () => {
        await page.getByText(/quote-only or not yet priced/i).waitFor();
      });
    } finally {
      await browser.close();
    }
  });
});
