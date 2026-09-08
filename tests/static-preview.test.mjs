import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";
const ROOT = new URL("..", import.meta.url);

async function withStaticServer(fn) {
  execFileSync(process.execPath, ["tools/cf-build.mjs"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const staticSite = await startStaticTestServer(new URL("../dist/", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

test("homepage static preview does not call unavailable api functions", async () => {
  await withStaticServer(async () => {
    const browser = await launchTestBrowser({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const badApiResponses = [];
      const consoleErrors = [];

      page.on("response", response => {
        const url = response.url();
        if (response.status() >= 400 && /\/api\/(track|products)\b/.test(url)) {
          badApiResponses.push(`${response.status()} ${response.request().method()} ${url}`);
        }
      });
      page.on("console", message => {
        if (message.type() === "error" && /api\/(track|products)/.test(message.text())) {
          consoleErrors.push(message.text());
        }
      });

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.locator(".proof-section").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      assert.deepEqual(badApiResponses, []);
      assert.deepEqual(consoleErrors, []);
      const proofImages = await page.locator(".proof-grid .proof-card img").evaluateAll(images =>
        images.map(image => ({
          src: image.currentSrc,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          hidden: image.hidden,
        }))
      );
      assert.equal(proofImages.length, 2);
      assert.equal(proofImages.every(image =>
        image.src.startsWith("https://media.masest.co/site/") &&
        image.complete &&
        image.naturalWidth > 0 &&
        !image.hidden
      ), true);
    } finally {
      await browser.close();
    }
  });
});

test("products static preview publishes the sanitized marine catalog", async () => {
  await withStaticServer(async () => {
    const browser = await launchTestBrowser({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const catalogResponses = [];
      const failedMarineAssets = [];
      const consoleErrors = [];
      const pageErrors = [];
      page.on("response", (response) => {
        const pathname = new URL(response.url()).pathname;
        if (/\/data\/(?:marine-catalog|industry-applications)\.json$/.test(pathname)) {
          catalogResponses.push([pathname, response.status()]);
        }
        if (response.status() >= 400 && /(?:marine-catalog|marine-studio|\/js\/main(?:\.js|\/))/.test(pathname)) {
          failedMarineAssets.push([pathname, response.status()]);
        }
      });
      page.on("console", (message) => {
        if (message.type() === "error" && !/Failed to load resource/.test(message.text())) consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/products", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ products: [] }),
      }));

      await page.goto(`${BASE_URL}/products.html?category=marine`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll('.shop-card[data-market="marine"]').length === 8);
      await page.locator(".shop-card").last().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll(".shop-card img")].every((image) => image.complete && image.naturalWidth > 0));

      assert.deepEqual(catalogResponses, [["/data/marine-catalog.json", 200]]);
      assert.deepEqual(failedMarineAssets, []);
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);
      assert.equal(await page.locator("#shopCount").textContent(), "8 products in Marine Line");
      assert.equal(
        await page.locator('.shop-card img[src^="https://media.masest.co/site/img/products/"]').count(),
        8,
      );
    } finally {
      await browser.close();
    }
  });
});
