import { test, expect } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

// The cart's ZIP-first shipping estimate. It answers "what will freight cost?" without
// sending the buyer into the address form to find out — but it is an estimate, so the guards
// here are as much about what it must NOT do (persist, look bookable, outlive its cart) as
// about the happy path.
let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
});

const CATALOG = {
  products: [
    { sku: "crhd", name: "VertKleen CR-HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
  ],
};

const ESTIMATE = {
  estimate: true,
  postal_code: "95112",
  package_count: 1,
  fulfillment: { ship_date: "2026-08-11" },
  rates: [
    { carrier_name: "UPS", service_type: "UPS® Ground", service_code: "ups_ground", amount_minor: 4620, currency: "usd", delivery_days: 4, estimated_delivery_date: "2026-08-15T00:00:00Z" },
    { carrier_name: "FedEx", service_type: "FedEx Ground®", service_code: "fedex_ground", amount_minor: 5090, currency: "usd", delivery_days: 5, estimated_delivery_date: "2026-08-16T00:00:00Z" },
  ],
};

async function openCart(page, { estimateResponse = ESTIMATE, estimateStatus = 200 } = {}) {
  const calls = [];
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(CATALOG),
  }));
  await page.route("**/api/shipping-estimate", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      status: estimateStatus, contentType: "application/json", body: JSON.stringify(estimateResponse),
    });
  });
  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 3 })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#checkoutContinue")).toBeVisible();
  return calls;
}

test("a ZIP estimate posts the cart and shows the cheapest rate in the shipping row", async ({ page }) => {
  const calls = await openCart(page);
  const form = page.locator("#shipEstimateForm");
  await expect(form).toBeVisible();
  // Before estimating, the row says what it has always said.
  await expect(page.locator("#cartEstimate")).toContainText("Calculated next");

  await page.locator("#shipEstimateZip").fill("95112");
  await page.locator("#shipEstimateGo").click();

  await expect(page.locator("#cartEstimate")).toContainText("$46.20");
  await expect(page.locator("#cartEstimate")).toContainText("est.");
  // Providers repeat the carrier inside service_type ("UPS® Ground"), so the label must read
  // "UPS Ground" and never "UPS UPS® Ground" — same rule the checkout rate list applies.
  await expect(page.locator("#shipEstimateNote")).toContainText("UPS Ground");
  await expect(page.locator("#shipEstimateNote")).not.toContainText("UPS UPS");
  await expect(page.locator("#shipEstimateNote")).toContainText("4 business days");
  // The caveat has to survive the copy trim — an estimate must never read as a firm price.
  await expect(page.locator("#shipEstimateNote")).toContainText("Exact rate at checkout");

  expect(calls).toHaveLength(1);
  expect(calls[0].destination).toEqual({ postal_code: "95112" });
  expect(calls[0].cart).toEqual([{ sku: "crhd", qty: 3 }]);
});

test("changing the cart drops an estimate quoted for the previous lines", async ({ page }) => {
  await openCart(page);
  await page.locator("#shipEstimateZip").fill("95112");
  await page.locator("#shipEstimateGo").click();
  await expect(page.locator("#cartEstimate")).toContainText("$46.20");

  // A price quoted for 3 jugs must not survive becoming a cart of 5.
  await page.locator('input[data-qty="crhd"]').fill("5");
  await page.locator('input[data-qty="crhd"]').dispatchEvent("input");
  await expect(page.locator("#cartEstimate")).toContainText("Calculated next");
  await expect(page.locator("#cartEstimate")).not.toContainText("$46.20");
  await expect(page.locator("#shipEstimateNote")).toContainText("Cart changed");
});

test("a multi-carton cart is told the rate comes at checkout, with no number invented", async ({ page }) => {
  await openCart(page, {
    estimateStatus: 409,
    estimateResponse: { error: "shipping_estimate_unavailable", package_count: 2 },
  });
  await page.locator("#shipEstimateZip").fill("95112");
  await page.locator("#shipEstimateGo").click();

  await expect(page.locator("#shipEstimateNote")).toContainText("more than one carton");
  // The subtotal still shows a price; the SHIPPING row must not invent one.
  const shippingRow = page.locator("#cartEstimate div").filter({ hasText: "Shipping" }).first();
  await expect(shippingRow).toContainText("Calculated next");
  await expect(shippingRow).not.toContainText("$");
});

test("a malformed ZIP is rejected in the browser without calling the rate service", async ({ page }) => {
  const calls = await openCart(page);
  await page.locator("#shipEstimateZip").fill("951");
  await page.locator("#shipEstimateGo").click();
  await expect(page.locator("#shipEstimateNote")).toContainText("5-digit US ZIP");
  await expect(page.locator("#shipEstimateZip")).toBeFocused();
  expect(calls).toHaveLength(0);
});

// Registration is a bare attribute with no visible effect until the launcher collides, so it
// is easy to drop in an unrelated edit. Measured behaviour it protects: at 1024x760 the
// launcher overlaps the checkout button by ~25px, so the button row must lift it — while the
// padded .cart-path card must NOT be registered, since its padding reaches the launcher at
// widths where the button never does and lifting on that dodges nothing a buyer can see.
test("the launcher clears the checkout button without lifting for card padding", async ({ page }) => {
  await openCart(page);
  await expect(page.locator(".cart-path-primary .cart-actions")).toHaveAttribute("data-customer-chat-obstruction", "");
  await expect(page.locator("#shipEstimateForm")).toHaveAttribute("data-customer-chat-obstruction", "");
  await expect(page.locator(".cart-path-primary")).not.toHaveAttribute("data-customer-chat-obstruction", "");

  await page.setViewportSize({ width: 1024, height: 760 });
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => {
    const l = document.querySelector(".customer-chat__toggle").getBoundingClientRect();
    const b = document.querySelector("#checkoutContinue").getBoundingClientRect();
    return l.left < b.right && l.right > b.left && l.top < b.bottom && l.bottom > b.top;
  });
  expect(hit, "launcher must not sit on the checkout button").toBe(false);
});

test("a rate-service failure never blocks checkout", async ({ page }) => {
  await openCart(page, { estimateStatus: 502, estimateResponse: { error: "shipping_rates_unavailable" } });
  await page.locator("#shipEstimateZip").fill("95112");
  await page.locator("#shipEstimateGo").click();
  await expect(page.locator("#shipEstimateNote")).toContainText("calculated at checkout");
  await expect(page.locator("#checkoutContinue")).toBeEnabled();
  await expect(page.locator("#checkoutContinue")).toBeVisible();
});

test("a delayed old ZIP estimate cannot overwrite the newer edited ZIP", async ({ page }) => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(CATALOG),
  }));
  await page.route("**/api/shipping-estimate", async (route) => {
    const postalCode = route.request().postDataJSON().destination.postal_code;
    calls.push(postalCode);
    if (postalCode === "95112") await firstGate;
    const amountMinor = postalCode === "95112" ? 1111 : 2222;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...ESTIMATE,
          postal_code: postalCode,
          rates: [{ ...ESTIMATE.rates[0], amount_minor: amountMinor }],
        }),
      });
    } catch {
      // The superseded request is intentionally aborted before its route is released.
    }
  });
  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 3 })));
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.locator("#shipEstimateZip").fill("95112");
  await page.locator("#shipEstimateGo").click();
  await expect.poll(() => calls.length).toBe(1);
  await page.locator("#shipEstimateZip").fill("95113");
  await expect(page.locator("#shipEstimateGo")).toBeEnabled();
  await page.locator("#shipEstimateGo").click();

  await expect(page.locator("#cartEstimate")).toContainText("$22.22");
  releaseFirst();
  await page.waitForTimeout(100);
  await expect(page.locator("#cartEstimate")).toContainText("$22.22");
  await expect(page.locator("#cartEstimate")).not.toContainText("$11.11");
  expect(calls).toEqual(["95112", "95113"]);
});
