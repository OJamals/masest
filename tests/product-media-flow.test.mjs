import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";

async function withServer(fn) {
  const staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
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
        name: "VertKleen CIP HCR",
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
    const browser = await launchTestBrowser({ channel: "chrome" });
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
    const browser = await launchTestBrowser({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products/hcr.html`, { waitUntil: "domcontentloaded" });

      const meta = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || "",
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
        ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
        ogUrl: document.querySelector('meta[property="og:url"]')?.content || "",
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      }));

      assert.equal(meta.title, "VertKleen CIP HCR | MASEST VertKleen");
      assert.match(meta.description, /Controlled mineral removal for brewery acid-wash steps/);
      assert.match(meta.description, /Target beer stone and mineral film/);
      assert.equal(meta.ogTitle, "VertKleen CIP HCR | MASEST VertKleen");
      assert.equal(meta.ogDescription, meta.description);
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
    const browser = await launchTestBrowser({ channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products/hcr.html`, { waitUntil: "domcontentloaded" });
      const image = page.locator('[data-commerce-media="hcr"] img');
      await image.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-commerce-media="hcr"] img')?.getAttribute("src") === "/img/products/owner-hcr.webp");
      assert.equal(await image.getAttribute("src"), "/img/products/owner-hcr.webp");
      assert.equal(await image.getAttribute("alt"), "Owner uploaded HCR drum photo");
    } finally {
      await browser.close();
    }
  });
});
