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
    assert.match(productsHtml, /href="services"/, "products page should link to the services page");
    assert.doesNotMatch(productsHtml, /data-service-catalog/, "products page should not embed service catalog");
    assert.match(productsHtml, /Buyable small-pack list pricing/);
    assert.match(productsHtml, /200\+ jugs: 5% off · 1,000\+ gallons \(drums\/totes\): 5% off\./);
    assert.match(productsHtml, /Drums and totes quoted before release/);
    assert.match(productsHtml, /USD, FOB Ex Plant Merritt Island, FL/);
    assert.match(productsHtml, /href="pricing-hvac-facilities"/);
    assert.match(productsHtml, /href="pricing-cip-food-beverage"/);
    assert.doesNotMatch(productsHtml, /55 and 275 gal freight finalized after order/);

    const services = await fetch(`${BASE_URL}/services.html`);
    assert.equal(services.status, 200, "services page should exist");
    const servicesHtml = await services.text();
    assert.match(servicesHtml, /data-service-catalog/, "services page should render the service catalog");
    assert.match(servicesHtml, /Technical services that make the chemical switch easier to approve/);
    assert.match(servicesHtml, /35 quote-service line items plus 4 service packages/);
    assert.doesNotMatch(servicesHtml, /"offerCount":"39"/);
    const schema = JSON.parse(servicesHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/)[1]);
    const serviceNode = schema["@graph"].find((node) => node["@type"] === "Service");
    assert.equal(serviceNode.offers.offerCount, 35);
    assert.match(serviceNode.offers.description, /quote-service line items/);

    const duplicateCatalogPages = readdirSync(root)
      .filter((name) => name.endsWith(".html") && name !== "services.html")
      .filter((name) => readFileSync(new URL(name, root), "utf8").includes("data-service-catalog"));
    assert.deepEqual(duplicateCatalogPages, [], "service catalog should live only on services.html");

    const resourcesHtml = await fetch(`${BASE_URL}/resources.html`).then((response) => response.text());
    assert.match(resourcesHtml, /href="pricing-hvac-facilities"/);
    assert.match(resourcesHtml, /href="pricing-cip-food-beverage"/);
    assert.doesNotMatch(resourcesHtml, /data-source-table="glycol-price-list"/);
    assert.doesNotMatch(resourcesHtml, /FOB Melbourne, FL/);
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

      assert.match(first.price, /^\$19\.27$/, "card should show the current first buyable pack price");
      assert.equal(first.subprice, "1 gal jug", "card should show the selected pack size");
      assert.ok(first.variantCount >= 3, "card should expose buyable pack choices");
      assert.equal(first.addLabel, "Add to cart");
      assert.equal(first.href, "products/cr");

      const cardStates = await page.locator(".shop-card").evaluateAll((cards) => cards.map((card) => ({
        id: card.dataset.id,
        price: card.querySelector(".price-main")?.textContent.trim() || "",
        buybar: !!card.querySelector(".shop-card-buybar"),
        select: !!card.querySelector(".commerce-vol"),
        add: !!card.querySelector("[data-cart-add]"),
        hasOneGal: [...card.querySelectorAll(".commerce-vol option")].some((option) => /1 gal/i.test(option.textContent || "")),
      })));
      assert.ok(cardStates.length > 0);
      assert.deepEqual(
        cardStates.filter((card) => !card.price || !card.buybar || !card.select || !card.add),
        [],
        "confirmed public product cards should expose price and buy controls"
      );
      assert.deepEqual(
        cardStates.filter((card) => !card.hasOneGal).map((card) => card.id),
        [],
        "confirmed public product cards should expose the NEW 1 gal jug option"
      );
      assert.equal(cardStates.some((card) => card.id === "eg5050"), false, "retired glycol SKUs should not render in the confirmed catalog");
      assert.deepEqual(apiErrors, []);
    } finally {
      await browser.close();
    }
  });
});

test("segment pricing pages render isolated HVAC and CIP workbook pricing", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const hvac = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await hvac.goto(`${BASE_URL}/pricing-hvac-facilities.html`, { waitUntil: "domcontentloaded" });
      await hvac.waitForSelector("[data-segment-pricing-row]");
      const hvacText = await hvac.locator("main").textContent();
      assert.match(hvacText, /HVAC & Facilities/);
      assert.match(hvacText, /VertKleen AlumiBrite/);
      assert.match(hvacText, /Prices valid six months from publication/);
      assert.match(hvacText, /Shipping and freight excluded — FOB Ex Plant, Merritt Island FL\./);
      assert.match(hvacText, /200\+ jugs: 5% off/);
      assert.match(hvacText, /VertKleen HCR[\s\S]*2\.5 gal jug[\s\S]*\$24\.72[\s\S]*\$61\.80/);
      assert.match(hvacText, /VertKleen CR[\s\S]*2\.5 gal jug[\s\S]*\$22\.02[\s\S]*\$55\.05/);
      assert.match(hvacText, /VertKleen Purgo[\s\S]*2\.5 gal jug[\s\S]*\$21\.49[\s\S]*\$53\.73/);

      const cip = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await cip.goto(`${BASE_URL}/pricing-cip-food-beverage.html`, { waitUntil: "domcontentloaded" });
      await cip.waitForSelector("[data-segment-pricing-row]");
      const cipText = await cip.locator("main").textContent();
      assert.match(cipText, /CIP Food & Beverage/);
      assert.match(cipText, /VertKleen CR/);
      assert.doesNotMatch(cipText, /VertKleen AlumiBrite/);
      assert.doesNotMatch(cipText, /VertKleen Descaler/);
      assert.match(cipText, /Prices valid six months from publication/);
      assert.match(cipText, /Shipping and freight excluded — FOB Ex Plant, Merritt Island FL\./);
      assert.match(cipText, /200\+ jugs: 5% off/);
    } finally {
      await browser.close();
    }
  });
});

test("resources page publishes corrected public pricing tables only", () => {
  const resources = readFileSync(new URL("resources.html", root), "utf8");
  assert.match(resources, /data-source-table="hvac-facility-pricing"[\s\S]*VertKleen HCR[\s\S]*2\.5 gal jug[\s\S]*\$24\.72\/gal[\s\S]*\$61\.80/);
  assert.match(resources, /data-source-table="hvac-facility-pricing"[\s\S]*VertKleen CR[\s\S]*2\.5 gal jug[\s\S]*\$22\.02\/gal[\s\S]*\$55\.05/);
  assert.match(resources, /data-source-table="property-maintenance-pricing"[\s\S]*VertKleen HCR[\s\S]*2\.5 gal jug[\s\S]*\$21\.63\/gal[\s\S]*\$54\.08/);
  assert.match(resources, /data-source-table="property-maintenance-pricing"[\s\S]*VertKleen CR[\s\S]*2\.5 gal jug[\s\S]*\$19\.27\/gal[\s\S]*\$48\.17/);
  assert.match(resources, /data-source-table="property-maintenance-pricing"[\s\S]*VertKleen CR HD[\s\S]*2\.5 gal jug[\s\S]*\$10\.61\/gal[\s\S]*\$26\.51/);
  assert.match(resources, /data-source-table="property-maintenance-pricing"[\s\S]*VertKleen Purgo[\s\S]*2\.5 gal jug[\s\S]*\$21\.49\/gal[\s\S]*\$53\.73/);
  assert.doesNotMatch(resources, /\$43\.26|\$38\.53|\$23\.57/, "internal B2B property rates must stay off public resources");
  assert.match(resources, /FOB Ex Plant, Merritt Island FL/);
});

test("descaler card defaults to the public 1 gal website price", async () => {
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
      const descaler = page.locator('.shop-card[data-id="descaler"]');
      await descaler.locator(".price-main", { hasText: "$15.03" }).waitFor();
      assert.equal(await descaler.locator(".price-note").textContent(), "1 gal jug");
      const options = await descaler.locator(".commerce-vol").evaluate((select) =>
        Array.from(select.options).map((option) => option.textContent.trim())
      );
      assert.ok(options.some((label) => /1 gal jug/.test(label)));
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
      await first.locator(".commerce-vol").selectOption("VK-CR-5G");
      await assert.doesNotReject(() => first.locator(".price-main", { hasText: "$96.34" }).waitFor());
      assert.equal(await first.locator(".price-note").textContent(), "5 gal pail");
      assert.equal(await first.locator("[data-cart-add]").getAttribute("data-cart-add"), "VK-CR-5G");
    } finally {
      await browser.close();
    }
  });
});
