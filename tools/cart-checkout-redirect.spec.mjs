import { test, expect } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

// End-to-end guard for the cart -> Stripe checkout hand-off. Stubs /api/products,
// /api/shipping-rates and /api/checkout (no real Stripe/ShipEngine/Supabase) and asserts
// (1) the POST body the browser sends uses the `cart` key the server reads, and (2) the
// returned session url drives a redirect. This is the integration-level counterpart to the
// static cart-key contract test; it would have caught the `items` vs `cart` mismatch that
// broke live checkout.
//
// b7c20088 split the one-page cart into cart.html (lines, quote link, "Continue to
// checkout") and checkout.html (contact, address, live rates, payment). The payment
// controls this file drives moved with it, and payment is now gated on a verified address
// and a selected carrier rate, so the flow below has to earn the enabled #checkoutPay
// rather than find one waiting.
let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

// One carrier rate is enough: checkout.js auto-selects index 0, so the buyer reaches an
// enabled #checkoutPay without a radio click, and rate.token is what must reach the server.
const RATE_QUOTE = {
  address: { address1: "500 Industrial Way", address2: "", city: "Tampa", state: "FL", postal_code: "33601", country: "US" },
  billing_address: null,
  address_validation: { corrected: false },
  package_count: 1,
  fulfillment: { ship_date: "2026-08-10" },
  rates: [{
    token: "rate_tok_1", carrier_name: "UPS", service_code: "ups_ground", service_name: "UPS Ground",
    amount_minor: 2450, currency: "usd", estimated_delivery_date: "2026-08-13", delivery_days: 3,
  }],
};

async function fillCheckoutContact(page, { email, po }) {
  await page.locator("#firstName").fill("Pat");
  await page.locator("#lastName").fill("Buyer");
  await page.locator("#checkoutEmail").fill(email);
  await page.locator("#phone").fill("8135550142");
  if (po) {
    // The PO field is collapsed behind its own disclosure.
    await page.locator("#poToggle").click();
    await page.locator("#purchaseOrderNumber").fill(po);
  }
}

// With no Google key configured, mountAddress() falls back to showManualAddress(), which
// reveals the fields and hides its own toggle — so the harness fills them directly. The
// toggle click is kept for the configured case, where autocomplete owns the line-1 input.
async function fillShippingAddress(page) {
  const manual = page.locator("#shippingManualToggle");
  if (await manual.isVisible()) await manual.click();
  await expect(page.locator("#shippingAddress1")).toBeVisible();
  await page.locator("#shippingAddress1").fill("500 Industrial Way");
  await page.locator("#shippingCity").fill("Tampa");
  await page.locator("#shippingState").fill("FL");
  await page.locator("#shippingPostalCode").fill("33601");
}

test("Card/ACH checkout posts the cart payload and redirects to the Stripe session url", async ({ page }) => {
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        { sku: "crhd", name: "VertKleen CR-HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
      ],
    }),
  }));

  let checkoutBody = null;
  await page.route("**/api/checkout", (route) => {
    checkoutBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      // A local stand-in for the Stripe Checkout url so the redirect stays on the test server.
      body: JSON.stringify({ url: `${BASE_URL}/order-confirmed.html?session_id=cs_test_stub` }),
    });
  });
  // order-confirmed.html looks up the session; keep it quiet so the test stays focused on the redirect.
  await page.route("**/api/order**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ order: null }),
  }));

  let ratesBody = null;
  await page.route("**/api/shipping-rates", (route) => {
    ratesBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(RATE_QUOTE),
    });
  });

  await page.goto(`${BASE_URL}/checkout.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2 })));
  await page.reload({ waitUntil: "domcontentloaded" });

  await fillCheckoutContact(page, { email: "buyer@example.com", po: "PO-1042" });
  await fillShippingAddress(page);

  // Payment stays shut until the address is verified and a rate is chosen.
  const payBtn = page.locator("#checkoutPay");
  await expect(payBtn).toBeDisabled();
  await page.locator("#calculateShipping").click();
  await expect(payBtn).toBeEnabled();
  expect(checkoutBody).toBeNull();
  expect(ratesBody.cart).toEqual([{ sku: "crhd", qty: 2 }]);

  await payBtn.click();
  await page.waitForURL("**/order-confirmed.html**");

  expect(checkoutBody).not.toBeNull();
  expect(checkoutBody.mode).toBe("pay");
  expect(checkoutBody.email).toBe("buyer@example.com");
  expect(checkoutBody.purchase_order_number).toBe("PO-1042");
  // The rate the buyer picked has to travel with the order, or the server reprices it.
  expect(checkoutBody.shipping_quote_token).toBe("rate_tok_1");
  // The line items must travel under `cart` (the key checkout.js reads) — never `items`.
  expect(checkoutBody.cart).toEqual([{ sku: "crhd", qty: 2 }]);
  expect(checkoutBody.items).toBeUndefined();
});


// There is deliberately no NET-terms test here. b7c20088 removed the storefront's
// "Place order with NET terms" button when it split cart.html and checkout.html, and that
// removal is intentional: NET orders are placed through sales, not self-serve. js/checkout.js
// is the client's only checkout() caller and it always sends mode:'pay'.
//
// functions/api/checkout.js still implements mode:'net', js/cart.js still builds its
// request_key, and dashboard.js + business.js still tell approved businesses NET terms are
// "unlocked" — all of that is now unreachable from the storefront and wants its own cleanup
// pass. Do not restore a NET case here to chase those; they are server and copy, not UI.
