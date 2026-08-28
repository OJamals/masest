import assert from "node:assert/strict";
import test from "node:test";

import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const PROJECT_ROOT = new URL("..", import.meta.url);
const INJECTION = '"><img data-catalog-injection src=x onerror="window.__catalogInjected=true">';

test("public product and service catalogs escape API-derived markup", async () => {
  const staticSite = await startStaticTestServer(PROJECT_ROOT);
  const browser = await launchTestBrowser({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });

  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "descaler",
        name: `VertKleen Descaler ${INJECTION}`,
        mode: "buy",
        active: true,
        image_url: `/images/products/descaler.png${INJECTION}`,
        photo_alt: `Descaler product photo ${INJECTION}`,
        product_variants: [{
          vsku: "DESCALER-1G",
          label: `1 gal jug ${INJECTION}`,
          gallons: 1,
          price: 39,
          currency: "usd",
          active: true,
          market: "industrial",
          package_kind: "unit",
          marketing_name: `VertKleen Descaler ${INJECTION}`,
          sort: 1,
        }],
      }],
    }),
  }));
  await page.route("**/data/content/services.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      service_categories: [{
        key: "Lab Testing - Water Analysis",
        slug: "water-analysis",
        title: "Water analysis",
        note: "Water chemistry testing.",
        description: "Test the submitted water sample.",
        icon: `ph-drop ${INJECTION}`,
        cta: `Request testing ${INJECTION}`,
        what_you_send: "A labeled sample.",
        what_you_receive: "A result report.",
        timing: "Timing confirmed before work starts.",
      }],
      services: [{
        sku: "MS-LAB-WTR-TEST",
        name: "Water test",
        summary: "Test one submitted water sample.",
        category: "Lab Testing - Water Analysis",
        unit: "per sample",
        active: true,
      }],
      service_packages: [],
    }),
  }));
  await page.route("**/api/pricing", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ services: [] }),
  }));

  try {
    await page.goto(`${staticSite.baseUrl}/products.html`, { waitUntil: "networkidle" });
    await page.locator('[data-cart-quick-add="descaler"]').waitFor({ state: "attached" });
    assert.equal(await page.locator("[data-catalog-injection]").count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__catalogInjected)), false);

    await page.goto(`${staticSite.baseUrl}/services.html`, { waitUntil: "networkidle" });
    await page.locator('[data-service-sku="MS-LAB-WTR-TEST"]').waitFor();
    assert.equal(await page.locator("[data-catalog-injection]").count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__catalogInjected)), false);
  } finally {
    await browser.close();
    await staticSite.close();
  }
});
