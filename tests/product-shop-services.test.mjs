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
      price: variant.package_kind === "bulk" ? null : Number(variant.sort) * 10,
      currency: variant.currency,
      active: variant.active,
      market: variant.market,
      package_kind: variant.package_kind,
      marketing_name: variant.marketing_name,
      units_per_case: variant.units_per_case,
      unit_vsku: variant.unit_sku,
      requires_quote: variant.requires_quote,
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
      market: variant.market,
      package_kind: variant.package_kind,
      units_per_case: variant.units_per_case,
      unit_vsku: variant.unit_sku,
      requires_quote: variant.requires_quote,
      active: variant.active,
      tiers: { retail: Number(variant.sort) * 10, hvac: Number(variant.sort) * 10 + 5 },
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
    assert.match(productsHtml, /VK5 saves 5% on eligible online orders; industrial cases save 10% versus singles\./);
    assert.match(productsHtml, /Get drum and tote pricing/);
    assert.match(productsHtml, /USD · FOB Merritt Island, FL · sales tax and freight extra/);
    assert.match(productsHtml, /href="pricing-hvac-facilities"/);
    assert.match(productsHtml, /href="pricing-cip-food-beverage"/);
    assert.doesNotMatch(productsHtml, /55 and 275 gal freight finalized after order/);

    const services = await fetch(`${BASE_URL}/services.html`);
    assert.equal(services.status, 200, "services page should exist");
    const servicesHtml = await services.text();
    assert.match(servicesHtml, /data-service-catalog/, "services page should render the service catalog");
    assert.match(servicesHtml, /Test the switch before you roll it out/);
    assert.match(servicesHtml, /Compare the finish, labor, water, and total job cost/);
    assert.match(servicesHtml, /With 35 services and 4 packages/);
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

test("service catalog preserves customer-facing compound words", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".service-card");
      const copy = await page.locator(".service-panels").textContent();

      for (const phrase of [
        "boiler-feed water",
        "chilled-water chemistry",
        "closed-loop water",
        "cooling-tower water",
        "hard-to-reach equipment",
        "high-magnification microscope",
        "sprinkler-system water",
      ]) {
        assert.match(copy, new RegExp(phrase), `service copy should preserve ${phrase}`);
      }
      assert.doesNotMatch(copy, /\b(?:boiler|chilled|closed|cooling|hard|high|sprinkler)\s+-\s+(?:feed|water|loop|tower|to|magnification|system)\b/i);
    } finally {
      await browser.close();
    }
  });
});

test("product cards expose price and compact quick add without a second control row", async () => {
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
        addSku: card.querySelector("[data-cart-quick-add]")?.dataset.cartAdd,
        addLabel: card.querySelector("[data-cart-quick-add]")?.getAttribute("aria-label"),
        href: card.querySelector(".shop-card-link")?.getAttribute("href")
      }));

      assert.equal(first.price, "$30", "card should show API pricing");
      assert.equal(first.subprice, "1 gal", "card should show the selected pack size");
      // SQ-12: the grid had zero size selectors — "quick-add" only ever added the
      // single default pack, and any other size cost a detail-page round trip. cr
      // has two active unit sizes (1 gal, 2.5 gal) in the seed catalog, so the
      // quick-add control now carries both as a real <select>.
      assert.equal(first.variantCount, 2, "card should offer real size selection, not push it to the detail page");
      assert.equal(first.addSku, "CRCIP-1G");
      assert.match(first.addLabel, /Add VertKleen CIP CR, 1 gal, to cart/i);
      // SQ-17: root-absolute — a relative "products/cr" resolved to
      // "/products/products/cr" from anywhere but /products itself.
      assert.equal(first.href, "/products/cr");

      const cardStates = await page.locator(".shop-card").evaluateAll((cards) => cards.map((card) => ({
        id: card.dataset.id,
        price: card.querySelector(".price-main")?.textContent.trim() || "",
        buybar: !!card.querySelector(".shop-card-buybar"),
        add: !!card.querySelector("[data-cart-quick-add]"),
        hasOneGal: /1 gal/i.test(card.querySelector("[data-cart-quick-add]")?.getAttribute("aria-label") || ""),
      })));
      assert.ok(cardStates.length > 0);
      assert.deepEqual(
        cardStates.filter((card) => !card.price || !card.buybar || !card.add),
        [],
        "confirmed public product cards should expose price, a buybar, and one quick-add control (plus a size select when the SKU has more than one active pack)"
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

test("staff product pages route commerce work to catalog management", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      window.MASEST_ENABLE_LOCAL_API = true;
      localStorage.setItem("sb-test-auth-token", "staff-session");
    });
    await page.route("**/js/auth.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        export async function getToken() { return "staff-token"; }
        export async function me() { return { email: "staff@example.test", profile: { full_name: "Avery Staff" }, staff: { role: "admin" }, can_admin: true }; }
        export async function api() { return { messages: [], threads: [], unread: 0 }; }
        export async function logout() {}
        export const supabase = { auth: { async getSession() { return { data: { session: { access_token: "staff-token" } }, error: null }; } } };
      `,
    }));
    await page.route("**/api/products", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiProductsPayload()),
    }));
    await routePricing(page);

    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".nav-account");
      await page.waitForSelector(".shop-card-buybar");

      assert.equal(await page.locator("html").getAttribute("data-account-kind"), "staff");
      assert.equal(await page.locator("[data-cart-add]").count(), 0, "staff should not receive buyer cart controls");
      assert.ok(
        await page.locator('a[href^="/admin.html?product_q="][href$="#products"]').count() > 0,
        "staff should receive an exact-product path to catalog management",
      );

      const support = page.locator(".site-support__launcher");
      await support.waitFor();
      const bounds = await support.boundingBox();
      assert.ok(bounds && bounds.width <= 56, `mobile staff support launcher should stay compact: ${JSON.stringify(bounds)}`);

      const leadBar = page.locator(".lead-action-bar");
      await leadBar.evaluate((node) => {
        node.classList.add("is-visible");
        node.classList.remove("is-suppressed");
        node.dataset.customerChatObstructionActive = "true";
      });
      await leadBar.waitFor({ state: "visible" });
      const [leadBounds, dockedBounds] = await Promise.all([
        leadBar.boundingBox(),
        support.boundingBox(),
      ]);
      assert.ok(leadBounds && dockedBounds, "staff support and lead actions should both have measurable bounds");
      assert.ok(
        dockedBounds.y + dockedBounds.height <= leadBounds.y,
        `staff support must clear the mobile lead actions: ${JSON.stringify({ leadBounds, dockedBounds })}`,
      );

      await support.click();
      const drawerBounds = await page.locator(".site-support__drawer").boundingBox();
      assert.ok(drawerBounds, "staff support drawer should open");
      assert.ok(drawerBounds.y >= 0, `staff support drawer should stay inside the viewport: ${JSON.stringify(drawerBounds)}`);
      assert.ok(
        drawerBounds.y + drawerBounds.height <= 844,
        `staff support drawer should not clip below the viewport: ${JSON.stringify(drawerBounds)}`,
      );
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
      assert.match(hvacText, /Prices exclude sales tax and freight\. FOB Merritt Island, FL\. Drums and totes are quote-only\./);
      assert.match(hvacText, /VK5 saves 5% on eligible online orders/);
      assert.match(hvacText, /VertKleen HVAC HCR[\s\S]*2\.5 gal[\s\S]*\$16\.00[\s\S]*\$40\.00/);
      assert.match(hvacText, /VertKleen HVAC CR[\s\S]*2\.5 gal[\s\S]*\$16\.00[\s\S]*\$40\.00/);
      assert.match(hvacText, /VertKleen Purgo[\s\S]*2\.5 gal[\s\S]*\$16\.00[\s\S]*\$40\.00/);

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
      assert.match(cipText, /Prices exclude sales tax and freight\. FOB Merritt Island, FL\. Drums and totes are quote-only\./);
      assert.match(cipText, /VK5 saves 5% on eligible online orders/);
      assert.match(cipText, /VertKleen CIP CR[\s\S]*2\.5 gal[\s\S]*\$16\.00[\s\S]*\$40\.00/);
    } finally {
      await browser.close();
    }
  });
});

test("resources page declares CMS-driven public pricing tables only", () => {
  const resources = readFileSync(new URL("resources.html", root), "utf8");
  const tiers = [...resources.matchAll(
    /data-variant-price-table[^>]*data-price-tier="([^"]+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(tiers, ["retail", "retail"]);
  assert.doesNotMatch(resources, /\$[0-9]/, "resources must not ship static prices");
  assert.match(resources, /Sales tax and freight excluded — FOB Merritt Island, FL\./);
});

test("descaler card defaults price and quick add to the first live API variant", async () => {
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
      await descaler.locator(".price-main", { hasText: "$30" }).waitFor();
      assert.equal(await descaler.locator(".price-note").textContent(), "1 gal");
      const quickAdd = descaler.locator('[data-cart-quick-add="descaler"]');
      assert.equal(await quickAdd.getAttribute("data-cart-add"), "DSC-1G");
      assert.match(await quickAdd.getAttribute("aria-label"), /1 gal/i);
      // SQ-12: descaler has two active unit sizes (1 gal, 2.5 gal), so the quick-add
      // now carries a real size select (one <select>, both packs as its <option>s)
      // defaulting to the first variant, rather than forcing every size but the
      // default to a detail-page visit.
      assert.equal(await descaler.locator(".commerce-vol").count(), 1);
    } finally {
      await browser.close();
    }
  });
});

test("changing product-detail volume updates the visible price and cart SKU", async () => {
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
      await page.goto(`${BASE_URL}/products/cr.html`, { waitUntil: "domcontentloaded" });
      const first = page.locator(".product-hero-buy");
      await first.locator(".commerce-vol").selectOption("CRCIP-25G");
      await assert.doesNotReject(() => first.locator(".price-main", { hasText: "$40" }).waitFor());
      assert.equal(await first.locator(".price-note").textContent(), "2.5 gal");
      assert.equal(await first.locator("[data-cart-add]").getAttribute("data-cart-add"), "CRCIP-25G");
    } finally {
      await browser.close();
    }
  });
});
