import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";
import { PRODUCT_CATALOG_COPY } from "../js/main/catalog-data.js";

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

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.MASEST_ENABLE_LOCAL_API = true;
  });
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
          { sku: "crhd", name: "VertKlean CR HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Add to cart/ }).click();

  await expect(page.getByText("Added to cart")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review cart" })).toHaveAttribute("href", "cart");
  await expect(page.locator("[data-cart-count]")).toHaveText("1");
});

test("buy selector defaults to the 5 gallon pail and routes bulk freight to quote", async ({ page }) => {
  await page.route("**/api/products", async route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        {
          sku: "crhd",
          name: "VertKlean CR HD",
          mode: "buy",
          active: true,
          product_variants: [
            { vsku: "VK-CRHD-1", label: "1 gal", gallons: 1, price: 8.48, currency: "usd", active: true, sort: 1 },
            { vsku: "VK-CRHD-5", label: "5 gal", gallons: 5, price: 42.42, currency: "usd", active: true, sort: 3 },
            // 55 gal needs freight review (active:false) and must swap the buy button for a quote CTA.
            { vsku: "VK-CRHD-55", label: "55 gal drum", gallons: 55, price: 281.82, currency: "usd", active: false, sort: 4 },
          ],
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=crhd`, { waitUntil: "networkidle" });

  await expect(page.locator("#pVol")).toHaveValue("VK-CRHD-5");
  await expect(page.locator("#pVol")).toContainText("55 gal drum");
  await expect(page.locator("#pUnitPrice")).toHaveText("$8.48/gal");
  await expect(page.locator("#pBuyBtn")).toBeVisible();
  await expect(page.locator("#pBulkQuoteBtn")).toBeHidden();

  await page.locator("#pVol").selectOption("VK-CRHD-55");
  await expect(page.locator("#pUnitPrice")).toHaveText("$5.12/gal");
  await expect(page.locator("#pStock")).toContainText("freight quoted");
  await expect(page.locator("#pBuyBtn")).toBeHidden();
  await expect(page.locator("#pBulkQuoteBtn")).toBeVisible();
  await expect(page.locator("#pBulkQuoteBtn")).toHaveAttribute("href", /freight%20quote/);
});

test("hcr bulk pricing shows freight-quote CTA through the commerce selector", async ({ page }) => {
  await page.route("**/api/products", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        {
          sku: "hcr",
          name: "VertKlean HCR",
          mode: "buy",
          active: true,
          product_variants: [
            { vsku: "hcr-1", label: "1 gal bottle", gallons: 1, price: 17.3, currency: "usd", active: true, sort: 1 },
            { vsku: "hcr-5", label: "5 gal pail", gallons: 5, price: 86.52, currency: "usd", active: true, sort: 2 },
            { vsku: "hcr-55", label: "55 gal drum", gallons: 55, price: 740.36, currency: "usd", active: false, sort: 3 },
          ],
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "networkidle" });

  await expect(page.locator("#pDrums")).toHaveCount(0);
  await expect(page.locator("#pVol")).toContainText("55 gal drum");
  await page.locator("#pVol").selectOption("hcr-55");
  await expect(page.locator("#pBuyBtn")).toBeHidden();
  await expect(page.locator("#pBulkQuoteBtn")).toBeVisible();
  await expect(page.locator("#pBulkQuoteBtn")).toHaveAttribute("href", /freight%20quote/);
});

test("catalog decision cues stay compact and actionable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route("**/api/products", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "hcr",
        name: "VertKlean CIP HCR",
        mode: "buy",
        active: true,
        product_variants: [
          { vsku: "hcr-1", label: "1 gal bottle", gallons: 1, price: 17.3, currency: "usd", active: true, sort: 1 },
        ],
      }],
    }),
  }));

  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
  const card = page.locator('.shop-card[data-id="hcr"]');
  const proofLink = card.getByRole("link", { name: "Review proof for VertKlean CIP HCR" });

  await expect(card.locator(".shop-card-fit")).toHaveCount(3);
  await expect(card.locator(".shop-card-proof-cue")).toHaveText(PRODUCT_CATALOG_COPY.hcr.proof);
  await expect(proofLink).toHaveAttribute("href", "products/hcr");
  await expect(card.locator("[data-cart-add]")).toBeVisible();

  const layout = await card.evaluate((element) => {
    const action = element.querySelector("[data-cart-add]");
    const decision = element.querySelector(".shop-card-decision");
    const actionRect = action?.getBoundingClientRect();
    const decisionRect = decision?.getBoundingClientRect();
    const cardRect = element.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardRight: cardRect.right,
      actionVisible: Boolean(actionRect?.width && actionRect?.height),
      decisionInsideCard: Boolean(
        decisionRect
        && decisionRect.left >= cardRect.left
        && decisionRect.right <= cardRect.right,
      ),
      actionBeforeDecision: Boolean(action?.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.actionVisible).toBe(true);
  expect(layout.decisionInsideCard).toBe(true);
  expect(layout.actionBeforeDecision).toBe(true);
});
