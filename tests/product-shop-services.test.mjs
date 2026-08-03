import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";
const root = new URL("../", import.meta.url);

async function withServer(fn) {
  const staticSite = await startStaticTestServer(root);
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
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
      price: Number(variant.sort) * 10,
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
      product_variants: product.slug === "cr"
        ? [
          ...(variants.get(product.slug) || []),
          { vsku: "cr-1-old", label: "1 gal duplicate", gallons: 1, price: 5, currency: "usd", active: true, sort: 0 },
          { vsku: "cr-55-old", label: "55 gal old drum", gallons: 55, price: 50, currency: "usd", active: false, sort: 0 },
        ]
        : variants.get(product.slug) || []
    }))
  };
}

function apiPricingPayload() {
  const catalog = JSON.parse(readFileSync(new URL("data/catalog.seed.json", root), "utf8"));
  const productNames = new Map(catalog.products.map((product) => [product.slug, product.name]));
  return {
    currency: "usd",
    variants: catalog.product_variants.map((variant) => ({
      vsku: variant.sku,
      product_sku: variant.product_slug,
      product_name: productNames.get(variant.product_slug),
      label: variant.label,
      gallons: variant.size_gal,
      active: variant.active,
      tiers: { retail: Number(variant.sort) * 10, hvac: Number(variant.sort) * 10 },
    })),
    services: [],
    pricing_tiers: [],
  };
}

const routePricing = (page) => page.route("**/api/pricing", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(apiPricingPayload()),
}));

test("products page is shop-focused and routes services to a standalone page", async () => {
  await withServer(async () => {
    const productsHtml = await fetch(`${BASE_URL}/products.html`).then((response) => response.text());
    assert.match(productsHtml, /href="services"/, "products page should link to the services page");
    assert.doesNotMatch(productsHtml, /data-service-catalog/, "products page should not embed service catalog");
    assert.match(productsHtml, /Small-pack list pricing/);
    assert.match(productsHtml, /200\+ jugs: 5% off · 1,000\+ gallons \(drums\/totes\): 5% off\./);
    assert.match(productsHtml, /Request quotes for drums and totes/);
    assert.match(productsHtml, /USD, FOB Ex Plant, Merritt Island FL/);
    assert.match(productsHtml, /href="pricing-hvac-facilities"/);
    assert.match(productsHtml, /href="pricing-cip-food-beverage"/);
    assert.doesNotMatch(productsHtml, /55 and 275 gal freight finalized after order/);

    const services = await fetch(`${BASE_URL}/services.html`);
    assert.equal(services.status, 200, "services page should exist");
    const servicesHtml = await services.text();
    assert.match(servicesHtml, /data-service-catalog/, "services page should render the service catalog");
    assert.match(servicesHtml, /Test the switch before you roll it out/);
    assert.match(servicesHtml, /Compare the finish, labor, water, and total job cost/);
    assert.match(servicesHtml, /With 35 line items and 4 packages/);
    assert.match(
      servicesHtml,
      /<img src="img\/representative\/applications\/deposit-analysis-service-v1\.webp"[^>]*width="1536" height="1024">/,
      "service proof should use a task-aligned landscape image with exact intrinsic dimensions",
    );
    assert.doesNotMatch(servicesHtml, /plate-after-enhanced\.webp/);
    assert.doesNotMatch(servicesHtml, /"offerCount":"39"/);
    const schema = JSON.parse(servicesHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/)[1]);
    const serviceNode = schema["@graph"].find((node) => node["@type"] === "Service");
    assert.equal(serviceNode.offers.offerCount, 35);
    assert.match(serviceNode.offers.description, /35 individual services/);

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
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const apiErrors = [];
    await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload())
    }));
    await routePricing(page);
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
        optionValues: Array.from(card.querySelectorAll(".commerce-vol option")).map((option) => option.value),
        addLabel: card.querySelector("[data-cart-add]")?.textContent.trim(),
        href: card.querySelector(".shop-card-link")?.getAttribute("href")
      }));

      assert.equal(first.price, "$10", "card should show API pricing");
      assert.equal(first.subprice, "1 gal jug", "card should show the selected pack size");
      assert.equal(first.variantCount, 5, "card should dedupe stale duplicate quantities while keeping quoted bulk choices");
      assert.equal(new Set(first.optionValues).size, first.optionValues.length, "volume options should not duplicate SKUs");
      assert.ok(!first.optionValues.includes("cr-1-old"), "stale duplicate active quantity should not be shown");
      assert.ok(!first.optionValues.includes("cr-55-old"), "stale duplicate quote quantity should not be shown");
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

test("segment pricing pages render isolated metadata with live API prices", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    try {
      const hvac = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await hvac.route("**/api/pricing", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiPricingPayload()),
      }));
      await hvac.goto(`${BASE_URL}/pricing-hvac-facilities.html`, { waitUntil: "domcontentloaded" });
      await hvac.waitForSelector("[data-segment-pricing-row]");
      const hvacText = await hvac.locator("main").textContent();
      assert.match(hvacText, /HVAC & Facilities/);
      assert.match(hvacText, /VertKleen AlumiBrite/);
      assert.match(hvacText, /Prices exclude shipping and freight\. FOB Ex Plant, Merritt Island, FL\./);
      assert.match(hvacText, /200\+ jugs: 5% off/);
      assert.match(hvacText, /VertKleen HCR[\s\S]*2\.5 gal jug[\s\S]*\$8\.00[\s\S]*\$20\.00/);
      assert.match(hvacText, /VertKleen CR[\s\S]*2\.5 gal jug[\s\S]*\$8\.00[\s\S]*\$20\.00/);
      assert.match(hvacText, /VertKleen Purgo[\s\S]*2\.5 gal jug[\s\S]*\$8\.00[\s\S]*\$20\.00/);

      const cip = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await cip.route("**/api/pricing", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiPricingPayload()),
      }));
      await cip.goto(`${BASE_URL}/pricing-cip-food-beverage.html`, { waitUntil: "domcontentloaded" });
      await cip.waitForSelector("[data-segment-pricing-row]");
      const cipText = await cip.locator("main").textContent();
      assert.match(cipText, /CIP pricing/);
      assert.match(cipText, /VertKleen CR/);
      assert.doesNotMatch(cipText, /VertKleen AlumiBrite/);
      assert.doesNotMatch(cipText, /VertKleen Descaler/);
      assert.match(cipText, /Prices exclude shipping and freight\. FOB Ex Plant, Merritt Island, FL\./);
      assert.match(cipText, /200\+ jugs: 5% off/);
    } finally {
      await browser.close();
    }
  });
});

test("resources page declares CMS-driven public pricing tables only", () => {
  const resources = readFileSync(new URL("resources.html", root), "utf8");
  assert.match(resources, /data-variant-price-table[^>]*data-price-tier="hvac"/);
  assert.match(resources, /data-variant-price-table[^>]*data-price-tier="retail"/);
  assert.doesNotMatch(resources, /\$[0-9]/, "resources must not ship static prices");
  assert.match(resources, /FOB Ex Plant, Merritt Island FL/);
});

test("descaler card defaults to the first live API variant price", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload())
    }));
    await routePricing(page);

    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      const descaler = page.locator('.shop-card[data-id="descaler"]');
      await descaler.locator(".price-main", { hasText: "$10" }).waitFor();
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
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload())
    }));
    await routePricing(page);

    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      const first = page.locator(".shop-card").first();
      await first.locator(".commerce-vol").selectOption("VK-CR-5G");
      await assert.doesNotReject(() => first.locator(".price-main", { hasText: "$30" }).waitFor());
      assert.equal(await first.locator(".price-note").textContent(), "5 gal pail");
      assert.equal(await first.locator("[data-cart-add]").getAttribute("data-cart-add"), "VK-CR-5G");
    } finally {
      await browser.close();
    }
  });
});
