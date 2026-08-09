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

// Street address is the longest thing a buyer types here. It is also the only checkout
// control that sits bare in .checkout-address-control rather than inside a .field, so it
// does not inherit `width:100%` — without an explicit width it collapses to the UA's
// default `size=20` (~183px in a 624px column) the moment manual entry is used.
async function expectAddressInputFillsColumn(page, id) {
  const box = await page.locator(`#${id}`).evaluate((el) => ({
    input: el.getBoundingClientRect().width,
    parent: el.parentElement.getBoundingClientRect().width,
  }));
  expect(box.parent).toBeGreaterThan(0);
  expect(box.input / box.parent).toBeGreaterThan(0.95);
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
  await expectAddressInputFillsColumn(page, "shippingAddress1");

  // Payment stays shut until the address is verified and a rate is chosen.
  const payBtn = page.locator("#checkoutPay");
  await expect(payBtn).toBeDisabled();
  await page.locator("#calculateShipping").click();
  await expect(payBtn).toBeEnabled();

  // The trust line under the button already names Stripe. The hint used to name it too,
  // stacking two consecutive sentences about Stripe under one control; it reports the
  // chosen service instead, and only the trust line carries the processor.
  const payHint = page.locator("#checkoutPayHint");
  await expect(payHint).toContainText("selected");
  await expect(payHint).not.toContainText("Stripe");
  await expect(page.locator(".checkout-payment-trust")).toContainText("Stripe");
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


// DECISION ON RECORD: NET-terms checkout stays off the storefront. b7c20088 removed the
// "Place order with NET terms" button when it split cart.html and checkout.html, and the
// cleanup pass that followed removed what sat behind it — mode:'net' in
// functions/api/checkout.js and the request_key builder in js/cart.js are gone, and the
// dashboard/business copy no longer says NET ordering is "unlocked". On-account orders are
// raised by sales from an accepted quote (functions/api/admin/quotes.js ->
// _lib/quote-convert.js netOrderRow()); js/checkout.js is the client's only checkout()
// caller and the payload hardcodes mode:'pay'.
//
// So the case below is a negative guard, not a NET flow: it pins that no on-account
// affordance came back and that the one NET route left is the link to sales. The positive
// half lives outside the browser — tests/credit-enforcement.test.mjs (the endpoint refuses
// any non-'pay' mode) and tests/business-net-terms-copy.test.mjs (the copy routes to the
// quote form). If the decision is ever reversed, all three move together.
test("an approved business gets the same card checkout, not an on-account button", async ({ page }) => {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://example.supabase.co";
    window.MASEST_SUPABASE_ANON = "anon";
  });
  await page.route("**/vendor/supabase-js.esm.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      export function createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: { access_token: "business-token" } } })
          }
        };
      }
    `,
  }));
  await page.route("**/api/account/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      email: "buyer@example.com",
      needs_profile: false,
      can_use_net_terms: true,
      company: { status: "approved", net_terms_days: 30 },
    }),
  }));
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        { sku: "crhd", name: "VertKleen CR-HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
      ],
    }),
  }));
  // An approved business must reach Stripe like everyone else, so nothing may post here
  // before the buyer has earned an enabled #checkoutPay.
  await page.route("**/api/checkout", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "checkout must not be reached" }),
  }));

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2 })));
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator(".cart-summary")).toBeVisible();
  await expect(page.getByRole("button", { name: /NET terms/i })).toHaveCount(0);

  await page.goto(`${BASE_URL}/checkout.html`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /NET terms/i })).toHaveCount(0);

  // Billing carries the same bare address input as shipping, so it needs the same guard.
  // The real checkbox is visually replaced by .checkout-switch, which swallows the click,
  // so drive it the way the page does — through its label.
  await page.locator('label[for="billingSameAsShipping"]').click();
  await expect(page.locator("#billingSameAsShipping")).not.toBeChecked();
  const billingManual = page.locator("#billingManualToggle");
  if (await billingManual.isVisible()) await billingManual.click();
  await expect(page.locator("#billingAddress1")).toBeVisible();
  await expectAddressInputFillsColumn(page, "billingAddress1");

  // The route to sales lives inside the collapsed "Business purchasing options" disclosure,
  // so match the element — a closed <details> keeps its contents out of the a11y tree.
  await expect(page.locator('#businessOptions a[href="contact.html?type=quote"]')).toHaveCount(1);
});
