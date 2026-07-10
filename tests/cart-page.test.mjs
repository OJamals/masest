import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function serverReady() {
  return new Promise(resolve => {
    const req = get(`${BASE_URL}/cart.html`, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      const ready = await serverReady();
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");

    await fn();
  } finally {
    if (!exited) server.kill("SIGTERM");
    await Promise.race([
      exitedOnce,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (!exited) {
      server.kill("SIGKILL");
      await Promise.race([
        exitedOnce,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
  }
}

function hcrProduct() {
  return {
    sku: "hcr",
    active: true,
    mode: "buy",
    image_url: "https://example.com/hcr.png",
    photo_alt: "VertKleen HCR pail",
    product_variants: [
      { vsku: "hcr-1", label: "1 gal bottle", gallons: 1, price: 17.3, currency: "usd", active: true, sort: 1 },
      { vsku: "hcr-2.5", label: "2.5 gal jug", gallons: 2.5, price: 43.26, currency: "usd", active: true, sort: 2 },
      { vsku: "hcr-5", label: "5 gal pail", gallons: 5, price: 86.52, currency: "usd", active: true, sort: 3 },
      { vsku: "hcr-55", label: "55 gal drum", gallons: 55, price: 740.36, currency: "usd", active: false, requires_quote: true, sort: 4 },
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
    const browser = await chromium.launch({ channel: "chrome" });
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
      assert.equal(await page.locator("#checkoutPay").isVisible(), false);
      assert.equal(await page.locator("#checkoutPay").isDisabled(), true);
      assert.equal(await page.evaluate(() => window.MASEST_DISABLE_CRISP), true);
    } finally {
      await browser.close();
    }
  });
});

test("confirmed catalog products hydrate buy controls instead of quote-first CTAs", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page, [hcrProduct(), ...confirmedProducts()]);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

      for (const id of ["watersafe60", "cr2", "sar"]) {
        const card = page.locator(`.shop-card[data-id="${id}"]`);
        await card.locator("[data-cart-add]").waitFor();
        assert.equal(await card.locator(".shop-card-quote").count(), 0);
        assert.equal(await card.locator(".commerce-vol").count(), 1);
      }
      assert.equal(await page.locator('.shop-card[data-id="eg5050"]').count(), 0);
    } finally {
      await browser.close();
    }
  });
});

test("product catalog shows public list pricing and small-pack selectors", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

      const hcr = page.locator('.shop-card[data-id="hcr"]');
      await hcr.getByText("$17.30").waitFor();
      const optionValues = await hcr.locator(".commerce-vol").evaluate(select =>
        Array.from(select.options).map(option => option.value)
      );
      assert.ok(optionValues.includes("hcr-1"));
      await page.getByRole("link", { name: /Compare programs/i }).waitFor();
      await page.getByRole("link", { name: /Become a distributor/i }).waitFor();

      assert.equal(await hcr.locator(".shop-card-quote").count(), 0);
      // Bulk drum is listed with its price, but selecting it swaps the cart
      // button for a prefilled quote link (no direct bulk orders).
      assert.equal(optionValues.includes("hcr-55"), true);

      await hcr.locator(".commerce-vol").selectOption("hcr-55");
      await hcr.getByText("$740.36").waitFor();
      assert.equal(await hcr.locator("[data-cart-add]").isVisible(), false);
      const quoteSwap = hcr.locator(".commerce-quote-swap");
      assert.equal(await quoteSwap.isVisible(), true);
      assert.match(
        await quoteSwap.getAttribute("href"),
        /^\/contact\?type=quote&product=.+&message=.+freight\+quote|^\/contact\?type=quote&product=.+&message=/,
      );

      await hcr.locator(".commerce-vol").selectOption("hcr-5");
      await hcr.getByText("$86.52").waitFor();
      assert.equal(await hcr.locator("[data-cart-add]").isVisible(), true);
      assert.equal(await quoteSwap.isVisible(), false);
      assert.equal(await hcr.locator("[data-cart-add]").getAttribute("data-cart-add"), "hcr-5");
    } finally {
      await browser.close();
    }
  });
});

test("priced products can be added to the cart", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
      await page.locator('.shop-card[data-id="hcr"] [data-cart-add]').click();

      await page.waitForFunction(() => localStorage.getItem("masest_cart")?.includes("hcr-1"));
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("masest_cart") || "{}"));
      assert.equal(cart["hcr-1"], 1);
    } finally {
      await browser.close();
    }
  });
});

test("cart page explains bulk freight review when checkout rejects a SKU", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.route("**/api/checkout", route => route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "not_purchasable",
          message: "Some SKUs need bulk freight review.",
        }),
      }));

      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ "hcr-1": 1 })));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#checkoutPay").click();

      await page.getByText(/bulk freight review/i).waitFor();
    } finally {
      await browser.close();
    }
  });
});

test("cart uses a conventional order summary without catalog policy duplication", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await routeProducts(page);
      await page.addInitScript(() => {
        localStorage.setItem("masest_cart", JSON.stringify({ "hcr-1": 2 }));
      });
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });

      await page.getByText("2 items").waitFor();
      await page.getByText("$34.60", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "Proceed to checkout" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Place order with NET terms" }).isVisible(), false);
      await page.getByRole("link", { name: "Request a quote" }).waitFor();
      assert.equal(await page.getByText(/200\+ jugs/i).count(), 0);
      assert.equal(await page.getByText(/Prices valid six months/i).count(), 0);
      assert.equal(await page.locator("#shipZone").count(), 0);
      assert.match(await page.locator(".cart-estimate").textContent(), /ShippingConfirmed separately/);
      assert.match(await page.locator(".cart-estimate").textContent(), /TaxCalculated at checkout/);
      assert.match(await page.locator(".cart-estimate").textContent(), /Final product pricing and discounts are confirmed at checkout/);
    } finally {
      await browser.close();
    }
  });
});

test("cart holds product lines until catalog names and pricing resolve", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        window.MASEST_ENABLE_LOCAL_API = true;
        localStorage.setItem("masest_cart", JSON.stringify({ "hcr-1": 1 }));
      });
      await page.route("**/api/products", async route => {
        await new Promise(resolve => setTimeout(resolve, 300));
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
      assert.equal(await page.getByText("hcr-1", { exact: true }).count(), 0);

      await page.locator(".cart-line").waitFor();
      assert.notEqual((await page.locator(".cart-line h2").textContent()).trim(), "hcr-1");
      assert.equal((await page.locator(".cart-line p").textContent()).trim(), "$17.30 each");
    } finally {
      await browser.close();
    }
  });
});

test("cart renders untrusted SKU text without creating injected markup", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        localStorage.setItem("masest_cart", JSON.stringify({
          '\"><img src=x data-cart-injection="true">': 1,
        }));
      });
      await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });

      await page.locator(".cart-line").waitFor();
      assert.equal(await page.locator("[data-cart-injection]").count(), 0);
      assert.match(await page.locator(".cart-line").textContent(), /<img src=x/);
    } finally {
      await browser.close();
    }
  });
});
