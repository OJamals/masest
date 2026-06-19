import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const root = new URL("../", import.meta.url);

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      const response = await fetch(`${BASE_URL}/products.html`).catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

function apiProductsPayload() {
  const catalog = JSON.parse(readFileSync(new URL("data/catalog.seed.json", root), "utf8"));
  const variants = new Map();
  for (const variant of catalog.product_variants) {
    if (!variants.has(variant.product_slug)) variants.set(variant.product_slug, []);
    variants.get(variant.product_slug).push({
      vsku: variant.sku,
      label: variant.label,
      gallons: variant.size_gal,
      price: variant.retail_price,
      currency: variant.currency,
      active: variant.active,
      sort: variant.sort
    });
  }
  return {
    products: catalog.products.map((product) => ({
      sku: product.slug,
      name: product.name,
      group_key: product.group_key,
      hmis: product.hmis,
      mode: product.mode,
      active: product.active,
      sort: product.sort,
      product_variants: variants.get(product.slug) || []
    }))
  };
}

test("products page is shop-focused and routes services to a standalone page", async () => {
  await withServer(async () => {
    const productsHtml = await fetch(`${BASE_URL}/products.html`).then((response) => response.text());
    assert.match(productsHtml, /href="services\.html"/, "products page should link to the services page");
    assert.doesNotMatch(productsHtml, /data-service-catalog/, "products page should not embed service catalog");
    assert.match(productsHtml, /Published retail list price/);
    assert.match(productsHtml, /USD, ex-plant Melbourne, FL/);
    assert.match(productsHtml, /55 and 275 gal freight finalized after order/);

    const services = await fetch(`${BASE_URL}/services.html`);
    assert.equal(services.status, 200, "services page should exist");
    const servicesHtml = await services.text();
    assert.match(servicesHtml, /data-service-catalog/, "services page should render the service catalog");
    assert.match(servicesHtml, /Testing, field support, and water-management services/);

    const duplicateCatalogPages = readdirSync(root)
      .filter((name) => name.endsWith(".html") && name !== "services.html")
      .filter((name) => readFileSync(new URL(name, root), "utf8").includes("data-service-catalog"));
    assert.deepEqual(duplicateCatalogPages, [], "service catalog should live only on services.html");
  });
});

test("product cards expose price, volume, and add-to-cart as one buying block", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const apiErrors = [];
    await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload())
    }));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) {
        apiErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".shop-card-buybar .price-main");

      const first = await page.locator(".shop-card").first().evaluate((card) => ({
        price: card.querySelector(".price-main")?.textContent.trim(),
        subprice: card.querySelector(".price-note")?.textContent.trim(),
        variantCount: card.querySelectorAll(".commerce-vol option").length,
        addLabel: card.querySelector("[data-cart-add]")?.textContent.trim(),
        href: card.querySelector(".shop-card-link")?.getAttribute("href")
      }));

      assert.match(first.price, /^\$17\.30$/, "card should show the current first buyable pack price");
      assert.equal(first.subprice, "1 gal", "card should show the selected pack size");
      assert.ok(first.variantCount >= 3, "card should expose buyable pack choices");
      assert.equal(first.addLabel, "Add to cart");
      assert.equal(first.href, "product.html?id=hcr");

      const cardStates = await page.locator(".shop-card").evaluateAll((cards) => cards.map((card) => ({
        id: card.dataset.id,
        price: card.querySelector(".price-main")?.textContent.trim() || "",
        buybar: !!card.querySelector(".shop-card-buybar"),
        select: !!card.querySelector(".commerce-vol"),
        add: !!card.querySelector("[data-cart-add]"),
      })));
      assert.ok(cardStates.length > 0);
      assert.deepEqual(
        cardStates.filter((card) => !card.price || !card.buybar || !card.select || !card.add),
        [],
        "every public product card should expose price and buy controls"
      );
      assert.deepEqual(apiErrors, []);
    } finally {
      await browser.close();
    }
  });
});

test("changing a card volume updates the visible price and cart SKU", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload())
    }));

    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      const first = page.locator(".shop-card").first();
      await first.locator(".commerce-vol").selectOption("VK-HCR-5");
      await assert.doesNotReject(() => first.locator(".price-main", { hasText: "$86.52" }).waitFor());
      assert.equal(await first.locator(".price-note").textContent(), "5 gal");
      assert.equal(await first.locator("[data-cart-add]").getAttribute("data-cart-add"), "VK-HCR-5");
    } finally {
      await browser.close();
    }
  });
});
