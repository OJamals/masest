import { test, expect } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

// End-to-end guard for the cart -> Stripe checkout hand-off. Stubs /api/products and
// /api/checkout (no real Stripe/Supabase) and asserts (1) the POST body the browser sends
// uses the `cart` key the server reads, and (2) the returned session url drives a redirect.
// This is the integration-level counterpart to the static cart-key contract test; it would
// have caught the `items` vs `cart` mismatch that broke live checkout.
let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

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

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2 })));
  await page.reload({ waitUntil: "domcontentloaded" });

  const receiptEmail = page.locator("#checkoutEmail");
  const payBtn = page.getByRole("button", { name: "Proceed to checkout" });
  await expect(payBtn).toBeEnabled();
  await receiptEmail.fill("not-an-email");
  await receiptEmail.press("Enter");
  await expect(page.locator("#cartStatus")).toHaveText("Enter a valid receipt email, or leave the field blank.");
  expect(checkoutBody).toBeNull();

  await receiptEmail.fill("buyer@example.com");
  await page.locator("#checkoutPurchaseOrder").fill("PO-1042");
  await receiptEmail.press("Enter");

  await page.waitForURL("**/order-confirmed.html**");

  expect(checkoutBody).not.toBeNull();
  expect(checkoutBody.mode).toBe("pay");
  expect(checkoutBody.email).toBe("buyer@example.com");
  expect(checkoutBody.purchase_order_number).toBe("PO-1042");
  // The line items must travel under `cart` (the key checkout.js reads) — never `items`.
  expect(checkoutBody.cart).toEqual([{ sku: "crhd", qty: 2 }]);
  expect(checkoutBody.items).toBeUndefined();
});

test("approved business NET checkout posts the cart payload with auth and clears the cart", async ({ page }) => {
  let checkoutBody = null;
  let checkoutAuth = null;

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
  await page.route("**/api/checkout", (route) => {
    checkoutAuth = route.request().headers().authorization;
    checkoutBody = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        net: true,
        order_id: "ord_net_1",
        message: "Order placed on account. A QuickBooks invoice will follow (NET terms).",
      }),
    });
  });

  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 2 })));
  await page.reload({ waitUntil: "domcontentloaded" });

  const netBtn = page.getByRole("button", { name: "Place order with NET terms" });
  await expect(netBtn).toBeEnabled();
  await page.locator("#checkoutPurchaseOrder").fill("PO-NET-77");
  await netBtn.click();

  await expect(page.locator("#cartStatus")).toContainText("Order placed on account");
  await expect(page.locator("#cartStatus")).toBeVisible();
  await expect(page.locator(".cart-summary")).toBeVisible();
  await expect(page.getByRole("link", { name: "View your orders" })).toBeVisible();
  expect(checkoutAuth).toBe("Bearer business-token");
  expect(checkoutBody.mode).toBe("net");
  expect(checkoutBody.email).toBe("buyer@example.com");
  expect(checkoutBody.purchase_order_number).toBe("PO-NET-77");
  expect(checkoutBody.cart).toEqual([{ sku: "crhd", qty: 2 }]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("masest_cart"))).toBe("{}");
});
