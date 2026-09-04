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

function hcrProduct() {
  return {
    sku: "hcr",
    name: "VertKleen CIP HCR",
    active: true,
    mode: "buy",
    image_url: "https://example.com/hcr.png",
    photo_alt: "VertKleen HCR pail",
    product_variants: [
      { vsku: "HCRCIP-1G", label: "1 gal", gallons: 1, price: 28.99, currency: "usd", active: true, market: "industrial", package_kind: "unit", marketing_name: "VertKleen CIP HCR", sort: 3 },
      { vsku: "HCRCIP-25G", label: "2.5 gal", gallons: 2.5, price: 68.49, currency: "usd", active: true, market: "industrial", package_kind: "unit", marketing_name: "VertKleen CIP HCR", sort: 4 },
      { vsku: "HCRCIP-55D", label: "55 gal drum", gallons: 55, price: null, currency: "usd", active: false, market: "industrial", package_kind: "bulk", marketing_name: "VertKleen CIP HCR", requires_quote: true, sort: 9 },
      { vsku: "HCRCIP-275T", label: "275 gal tote", gallons: 275, price: null, currency: "usd", active: false, market: "industrial", package_kind: "bulk", marketing_name: "VertKleen CIP HCR", requires_quote: true, sort: 10 },
    ],
  };
}

function marineHcrProduct() {
  return {
    sku: "hcr-t16",
    name: "VertKleen HVAC HCR",
    active: true,
    mode: "buy",
    image_url: "https://example.com/hcr-t16.png",
    photo_alt: "VertKleen HVAC HCR pail",
    product_variants: [
      { vsku: "hcr-t16-1", label: "1 gal bottle", gallons: 1, price: 29.5, currency: "usd", active: true, sort: 1 },
    ],
  };
}

function confirmedProducts() {
  return ["watersafe60", "cr2", "sar"].map((sku) => ({
    sku,
    active: true,
    mode: "buy",
    product_variants: [
      { vsku: `${sku}-1`, label: "1 gal", gallons: 1, price: 9.99, currency: "usd", active: true, sort: 1 },
    ],
  }));
}

async function routeProducts(page, products = [hcrProduct()]) {
  await page.addInitScript(() => {
    window.MASEST_ENABLE_LOCAL_API = true;
  });
  await page.route("**/api/products", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ products }),
  }));
}

test("static catalog does not show cart controls without commerce metadata", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.locator(".shop-card").first().waitFor();

      assert.equal(await page.locator("[data-cart-add]").count(), 0);
      assert.equal(await page.locator(".shop-card-quote").count(), 0);

      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
      // Empty cart keeps one clear continuation path; checkout summary stays out
      // of the visual and accessibility trees until it can be used.
      await page.locator(".cart-empty").waitFor();
      assert.equal(await page.locator(".cart-summary").isVisible(), false);
      assert.equal(await page.locator("#checkoutContinue").isVisible(), false);
    } finally {
      await browser.close();
    }
  });
});

test("confirmed catalog products hydrate compact quick-add controls instead of quote-first CTAs", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page, [hcrProduct(), ...confirmedProducts()]);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

      for (const id of ["watersafe60", "cr2", "sar"]) {
        const card = page.locator(`.shop-card[data-id="${id}"]`);
        await card.locator(`[data-cart-quick-add="${id}"]`).waitFor();
        assert.equal(await card.locator(".shop-card-quote").count(), 0);
        assert.equal(await card.locator(".commerce-vol").count(), 0);
      }
      assert.equal(await page.locator('.shop-card[data-id="eg5050"]').count(), 0);
    } finally {
      await browser.close();
    }
  });
});

test("product catalog shows public list pricing and compact default-pack quick add", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

      const hcr = page.locator('.shop-card[data-id="hcr"]');
      await hcr.locator(".price-main", { hasText: "$28.99" }).waitFor();
      const quickAdd = hcr.locator('[data-cart-quick-add="hcr"]');
      assert.equal(await quickAdd.getAttribute("data-cart-add"), "HCRCIP-1G");
      assert.match(await quickAdd.getAttribute("aria-label"), /1 gal/i);
      assert.equal(await hcr.locator(".commerce-vol").count(), 0);
      await page.getByRole("link", { name: /Get product recommendation/i }).waitFor();
      await page.getByRole("link", { name: /Become a distributor/i }).waitFor();

      assert.equal(await hcr.locator(".shop-card-quote").count(), 0);
      assert.doesNotMatch(await hcr.textContent(), /\$0(?:\.00)?\b/, "bulk must never render as a zero-price card option");

      await page.goto(`${BASE_URL}/products/hcr.html`, { waitUntil: "domcontentloaded" });
      const detailBuy = page.locator(".product-hero-buy");
      const detailSelect = detailBuy.locator(".commerce-vol");
      await detailSelect.waitFor();
      const optionValues = await detailSelect.evaluate(select => Array.from(select.options).map(option => option.value));
      assert.deepEqual(optionValues, ["HCRCIP-1G", "HCRCIP-25G", "HCRCIP-55D", "HCRCIP-275T"]);
      await detailSelect.selectOption("HCRCIP-55D");
      await detailBuy.locator(".price-main", { hasText: "Quote-priced" }).waitFor();
      assert.equal(await detailBuy.locator("[data-cart-add]").isVisible(), false);
      const quoteSwap = detailBuy.locator(".commerce-quote-swap");
      assert.equal(await quoteSwap.isVisible(), true);
      assert.match(
        await quoteSwap.getAttribute("href"),
        /^\/contact\?type=quote&product=.+&message=.+freight\+quote|^\/contact\?type=quote&product=.+&message=/,
      );

      await detailSelect.selectOption("HCRCIP-25G");
      await detailBuy.locator(".price-main", { hasText: "$68.49" }).waitFor();
      assert.equal(await detailBuy.locator("[data-cart-add]").isVisible(), true);
      assert.equal(await quoteSwap.isVisible(), false);
      assert.equal(await detailBuy.locator("[data-cart-add]").getAttribute("data-cart-add"), "HCRCIP-25G");
    } finally {
      await browser.close();
    }
  });
});

test("priced products can be added to the cart", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.locator('.shop-card[data-id="hcr"] [data-cart-add]').click();

      await page.waitForFunction(() => localStorage.getItem("masest_cart")?.includes("HCRCIP-1G"));
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("masest_cart") || "{}"));
      assert.equal(cart["HCRCIP-1G"], 1);
    } finally {
      await browser.close();
    }
  });
});

test("cart routes purchasable SKUs to delivery checkout before provider validation", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ "HCRCIP-1G": 1 })));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#checkoutContinue").click();
      await page.waitForURL(/\/checkout\.html$/);
      await page.getByRole("heading", { name: "Delivery checkout" }).waitFor();
    } finally {
      await browser.close();
    }
  });
});

test("cart uses a conventional order summary without catalog policy duplication", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.addInitScript(() => {
        localStorage.setItem("masest_cart", JSON.stringify({ "HCRCIP-1G": 2 }));
      });
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });

      await page.getByText("2 items").waitFor();
      await page.getByText("$57.98", { exact: true }).first().waitFor();
      const productImage = page.locator('.cart-line-media img');
      assert.equal(await productImage.getAttribute('src'), 'https://example.com/hcr.png');
      assert.equal(await productImage.getAttribute('alt'), 'VertKleen HCR pail');
      await page.getByRole("link", { name: "Continue to checkout", exact: true }).waitFor();
      await page.getByRole("link", { name: "Get a quote", exact: true }).waitFor();
      assert.equal(await page.locator(".cart-path-primary").count(), 1);
      assert.equal(await page.locator(".cart-path-quote").count(), 1);
      assert.equal(await page.locator(".cart-path-requisition").count(), 1);
      assert.equal(await page.getByText(/200\+ jugs/i).count(), 0);
      assert.equal(await page.getByText(/Prices valid six months/i).count(), 0);
      assert.equal(await page.locator("#shipZone").count(), 0);
      assert.match(await page.locator(".cart-estimate").textContent(), /ShippingCalculated next/);
      assert.match(await page.locator(".cart-estimate").textContent(), /TaxCalculated at checkout/);
      assert.match(await page.locator(".cart-estimate").textContent(), /Final product pricing and discounts are confirmed at checkout/);
    } finally {
      await browser.close();
    }
  });
});

test("cart holds product lines until catalog names and pricing resolve", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    let releaseProducts;
    const productsBlocked = new Promise(resolve => {
      releaseProducts = resolve;
    });
    try {
      await page.addInitScript(() => {
        window.MASEST_ENABLE_LOCAL_API = true;
        localStorage.setItem("masest_cart", JSON.stringify({ "HCRCIP-1G": 1 }));
      });
      await page.route("**/api/products", async route => {
        await productsBlocked;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ products: [hcrProduct()] }),
        });
      });

      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
      await page.getByText("Loading cart details…", { exact: true }).waitFor();
      assert.equal(await page.locator(".cart-line").count(), 0);
      assert.equal(await page.getByText("Pending review", { exact: true }).count(), 0);
      assert.equal(await page.getByText("HCRCIP-1G", { exact: true }).count(), 0);

      releaseProducts();
      await page.locator(".cart-line").waitFor();
      assert.notEqual((await page.locator(".cart-line h2").textContent()).trim(), "HCRCIP-1G");
      assert.equal((await page.locator(".cart-line p").textContent()).trim(), "$28.99 each");
    } finally {
      releaseProducts?.();
      await browser.close();
    }
  });
});

test("cart preserves marine selection context without changing the canonical line item", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page, [marineHcrProduct()]);
      await page.addInitScript(() => {
        localStorage.setItem("masest_cart", JSON.stringify({ "hcr-t16-1": 1 }));
        localStorage.setItem("masest_cart_presentation_v1", JSON.stringify({
          "hcr-t16-1": { market: "marine", name: "Scale Buster", product: "hcr-t16" },
        }));
      });
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });

      const context = page.locator(".cart-line-market");
      await context.waitFor();
      assert.match(await context.textContent(), /Marine selection\s*Scale Buster/);
      assert.equal(
        await page.locator(".cart-line-product-link").getAttribute("href"),
        "products/hcr-t16?market=marine",
      );
      assert.match(await page.locator(".cart-line h2").textContent(), /VertKleen HVAC HCR - 1 gal bottle/);
    } finally {
      await browser.close();
    }
  });
});

test("cart renders untrusted SKU text without creating injected markup", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        const sku = '\"><img src=x data-cart-injection="true">';
        localStorage.setItem("masest_cart", JSON.stringify({ [sku]: 1 }));
        localStorage.setItem("masest_cart_presentation_v1", JSON.stringify({
          [sku]: {
            market: "marine",
            name: '<img src=x data-market-injection="true">',
            product: "hcr-t16",
          },
        }));
      });
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });

      await page.locator(".cart-line").waitFor();
      assert.equal(await page.locator("[data-cart-injection]").count(), 0);
      assert.equal(await page.locator("[data-market-injection]").count(), 0);
      assert.match(await page.locator(".cart-line").textContent(), /<img src=x/);
    } finally {
      await browser.close();
    }
  });
});
