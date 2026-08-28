import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const PROJECT_ROOT = new URL("..", import.meta.url);

function productPayload() {
  return {
    products: [{
      sku: "descaler",
      name: "VertKleen Descaler",
      mode: "buy",
      active: true,
      product_variants: [{
        vsku: "DESCALER-1G",
        label: "1 gal jug",
        gallons: 1,
        price: 39,
        currency: "usd",
        active: true,
        market: "industrial",
        package_kind: "unit",
        marketing_name: "VertKleen Descaler",
        sort: 1,
      }],
    }],
  };
}

test("local product routes keep a working purchase path and catalog quick add", async () => {
  const staticSite = await startStaticTestServer(PROJECT_ROOT);
  const browser = await launchTestBrowser({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  let catalogRequests = 0;
  await page.route("**/api/products", (route) => {
    catalogRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productPayload()),
    });
  });

  try {
    await page.goto(`${staticSite.baseUrl}/products/descaler.html`, { waitUntil: "networkidle" });
    const detailAdd = page.locator('.product-hero-buy [data-cart-add="DESCALER-1G"]');
    assert.equal(catalogRequests, 1, "localhost product detail should request its live catalog");
    assert.equal(await detailAdd.count(), 1, "product detail should expose Add to cart");
    assert.equal(await detailAdd.isVisible(), true);

    await page.goto(`${staticSite.baseUrl}/products.html`, { waitUntil: "networkidle" });
    const card = page.locator('.shop-card[data-id="descaler"]');
    const quickAdd = card.locator('[data-cart-quick-add="descaler"]');
    assert.equal(await quickAdd.count(), 1, "catalog card should expose one compact quick-add control");
    assert.match(await quickAdd.getAttribute("aria-label"), /add vertkleen descaler.*1 gal.*cart/i);
    assert.equal(await card.locator('.shop-card-buybar [data-cart-add]').count(), 0, "catalog should not duplicate a full-size add button");

    const geometry = await quickAdd.evaluate((button) => {
      const control = button.getBoundingClientRect();
      const stage = button.closest(".shop-card-media-wrap")?.getBoundingClientRect();
      return {
        position: getComputedStyle(button.closest(".shop-card-quick-commerce")).position,
        width: control.width,
        height: control.height,
        insideStage: !!stage
          && control.left >= stage.left
          && control.right <= stage.right
          && control.top >= stage.top
          && control.bottom <= stage.bottom,
      };
    });
    assert.equal(geometry.position, "absolute", "quick add should overlay the media instead of taking card space");
    assert.ok(geometry.width >= 44 && geometry.height >= 44, `quick add must remain a 44px tap target: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.insideStage, true, "quick add should stay inside the product image stage");

    await quickAdd.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-cart-quick-add="descaler"]')?.dataset.cartState === "added"
    ));
    assert.equal(await quickAdd.getAttribute("data-cart-state"), "added");
    assert.match(await quickAdd.getAttribute("aria-label"), /added vertkleen descaler.*cart/i);
    assert.equal(await quickAdd.locator("i").getAttribute("class"), "ph ph-check");

    await page.goto(`${staticSite.baseUrl}/cart.html`, { waitUntil: "networkidle" });
    assert.equal(
      (await page.locator(".cart-line h2").textContent()).trim(),
      "VertKleen Descaler - 1 gal jug",
      "cart should resolve the selected product and pack instead of repeating a raw SKU",
    );
    assert.equal((await page.locator(".cart-line p").textContent()).trim(), "$39.00 each");
    assert.equal(await page.getByText("Pending review", { exact: true }).count(), 0);
  } finally {
    await browser.close();
    await staticSite.close();
  }
});
