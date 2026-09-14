import assert from "node:assert/strict";
import test from "node:test";
import {
  caseSavingsFor,
  caseSavingsText,
} from "../js/main/commerce-ui.js";
import { shapePublicProductVariant } from "../functions/api/products.js";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const PROJECT_ROOT = new URL("..", import.meta.url);

function commerceRow() {
  const unit = {
    vsku: "HCR-1G",
    label: "1 gal jug",
    gallons: 1,
    price: 25,
    currency: "USD",
    package_kind: "unit",
  };
  const caseVariant = {
    vsku: "HCR-1G-CS",
    label: "case of 4 × 1 gal",
    gallons: 4,
    price: 90,
    currency: "USD",
    package_kind: "case",
    units_per_case: 4,
    unit_vsku: unit.vsku,
    case_contact_available: true,
  };
  return { variants: [unit], caseVariants: [caseVariant], unit, caseVariant };
}

test("case savings use linked account-effective prices, never a hard-coded claim", () => {
  const { variants, caseVariants, unit, caseVariant } = commerceRow();
  const row = { variants, caseVariants };

  assert.deepEqual(caseSavingsFor(row, unit), {
    caseVariant,
    unitVariant: unit,
    units: 4,
    regularPrice: 100,
    casePrice: 90,
    savings: 10,
    percent: 10,
  });
  assert.deepEqual(caseSavingsFor(row, caseVariant), caseSavingsFor(row, unit));
  assert.equal(caseSavingsText(row, unit), "Case of 4 saves $10 (10%)");
});

test("case savings fail closed when the linked unit or comparable currency is unavailable", () => {
  const { variants, caseVariants, unit } = commerceRow();
  assert.equal(caseSavingsFor({ variants: [], caseVariants }, unit), null);
  assert.equal(caseSavingsFor({ variants, caseVariants: [{ ...caseVariants[0], currency: "CAD" }] }, unit), null);
  assert.equal(caseSavingsFor({ variants, caseVariants: [{ ...caseVariants[0], price: 100 }] }, unit), null);
});

test("public product projection marks only verified pending cases as contact-orderable", () => {
  const pendingCase = {
    vsku: "HCR-1G-CS",
    label: "case of 4 × 1 gal",
    price: 90,
    currency: "usd",
    active: false,
    package_kind: "case",
    intended_active: true,
    activation_blocker: "shipping_package_profile_missing",
  };
  const shaped = shapePublicProductVariant(pendingCase, new Map([[pendingCase.vsku, 84]]));

  assert.equal(shaped.price, 84, "account tier override remains authoritative");
  assert.equal(shaped.list_price, 90);
  assert.equal(shaped.case_contact_available, true);
  assert.equal("intended_active" in shaped, false, "internal launch state must not leak");
  assert.equal("activation_blocker" in shaped, false, "internal blocker must not leak");
  assert.equal(
    shapePublicProductVariant({ ...pendingCase, intended_active: false }, new Map()).case_contact_available,
    false,
  );
  assert.equal(
    shapePublicProductVariant({ ...pendingCase, intended_active: undefined }, new Map()).case_contact_available,
    false,
  );
});

test("product detail offers exact case savings without sending an inactive case to checkout", async () => {
  const staticSite = await startStaticTestServer(PROJECT_ROOT);
  const browser = await launchTestBrowser();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "hcr",
        name: "VertKleen HCR",
        mode: "buy",
        active: true,
        product_variants: [{
          vsku: "HCR-1G",
          label: "1 gal jug",
          gallons: 1,
          price: 25,
          currency: "usd",
          active: true,
          market: "industrial",
          package_kind: "unit",
          marketing_name: "VertKleen HCR",
          sort: 1,
        }, {
          vsku: "HCR-1G-CS",
          label: "case of 4 × 1 gal",
          gallons: 4,
          price: 90,
          currency: "usd",
          active: false,
          market: "industrial",
          package_kind: "case",
          marketing_name: "VertKleen HCR",
          units_per_case: 4,
          unit_vsku: "HCR-1G",
          case_contact_available: true,
          sort: 5,
        }],
      }],
    }),
  }));

  try {
    await page.goto(`${staticSite.baseUrl}/products/hcr.html`, { waitUntil: "domcontentloaded" });
    const select = page.locator('[data-commerce-buy="hcr"] .commerce-vol');
    await select.waitFor();

    assert.deepEqual(await select.locator("option").allTextContents(), [
      "1 gal — $25",
      "4 × 1 gal case — $90 · 10% off",
    ]);
    assert.equal(
      await page.locator('.product-hero-buy .shop-card-savings').textContent(),
      "Case of 4 saves $10 (10%)",
    );

    await select.selectOption("HCR-1G-CS");
    assert.equal(await page.locator('.product-hero-buy .price-main').textContent(), "$90");
    assert.match(await page.locator('.product-hero-buy .price-note').textContent(), /freight confirmed/i);
    assert.equal(await page.locator('.product-hero-buy [data-cart-add]').isHidden(), true);
    assert.equal(await page.locator('.product-hero-buy .commerce-quote-swap').textContent(), "Request case order");

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${staticSite.baseUrl}/products.html`, { waitUntil: "domcontentloaded" });
    const card = page.locator('.shop-card[data-id="hcr"]');
    const quickAdd = card.locator('[data-cart-quick-add="hcr"]');
    await quickAdd.waitFor();
    assert.match(await quickAdd.getAttribute("aria-label"), /1 gal/i);
    assert.equal(await card.locator(".shop-card-savings").textContent(), "Case of 4 saves $10 (10%)");
    const measureCompactBuyingFit = () => card.evaluate((element) => {
      const quick = element.querySelector("[data-cart-quick-add]").getBoundingClientRect();
      const stage = element.querySelector(".shop-card-media-wrap").getBoundingClientRect();
      const savings = element.querySelector(".shop-card-savings");
      return {
        quickWidth: quick.width,
        quickHeight: quick.height,
        quickInsideStage: quick.left >= stage.left && quick.right <= stage.right
          && quick.top >= stage.top && quick.bottom <= stage.bottom,
        savingsFits: savings.scrollWidth <= savings.clientWidth + 1,
      };
    });
    const compactFit = await measureCompactBuyingFit();
    assert.deepEqual(compactFit, { quickWidth: 44, quickHeight: 44, quickInsideStage: true, savingsFits: true });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopFit = await measureCompactBuyingFit();
    assert.deepEqual(desktopFit, { quickWidth: 44, quickHeight: 44, quickInsideStage: true, savingsFits: true });
  } finally {
    await browser.close();
    await staticSite.close();
  }
});
