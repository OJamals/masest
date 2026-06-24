import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${BASE_URL}/products.html`);
        if (response.ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

async function routeProducts(page) {
  await page.addInitScript(() => {
    window.MASEST_ENABLE_LOCAL_API = true;
  });
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "hcr",
        name: "VertKleen HCR",
        active: true,
        mode: "buy",
        price: 42,
        currency: "usd",
        image_url: "img/products/owner-hcr.webp",
        photo_alt: "Owner uploaded HCR drum photo",
      }],
    }),
  }));
}

test("storefront grid uses owner-updated product photos from the commerce API", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      const image = page.locator('.shop-card[data-id="hcr"] .shop-card-media img');
      await image.waitFor();
      assert.equal(await image.getAttribute("src"), "img/products/owner-hcr.webp");
      assert.equal(await image.getAttribute("alt"), "Owner uploaded HCR drum photo");
    } finally {
      await browser.close();
    }
  });
});

test("product detail publishes product-specific SEO metadata", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page);
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#pName")?.textContent.includes("VertKleen HCR"));

      const meta = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || "",
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
        ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
        ogUrl: document.querySelector('meta[property="og:url"]')?.content || "",
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      }));

      assert.equal(meta.title, "VertKleen HCR | MASEST VertKleen");
      assert.match(meta.description, /descaling, rust removal, passivation/);
      assert.equal(meta.ogTitle, "VertKleen HCR | MASEST VertKleen");
      assert.match(meta.ogDescription, /descaling, rust removal, passivation/);
      assert.doesNotMatch(meta.description, /Replaces Replaces/);
      assert.equal(meta.ogUrl, "https://masest.co/products/hcr");
      assert.equal(meta.canonical, "https://masest.co/products/hcr");
    } finally {
      await browser.close();
    }
  });
});

test("product detail uses owner-updated product photos from the commerce API", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page);
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      const image = page.locator("#pImage");
      await image.waitFor();
      await page.waitForFunction(() => document.querySelector("#pImage")?.getAttribute("src") === "img/products/owner-hcr.webp");
      assert.equal(await image.getAttribute("src"), "img/products/owner-hcr.webp");
      assert.equal(await image.getAttribute("alt"), "Owner uploaded HCR drum photo");
    } finally {
      await browser.close();
    }
  });
});
