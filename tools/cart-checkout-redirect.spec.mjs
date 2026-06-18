import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// End-to-end guard for the cart -> Stripe checkout hand-off. Stubs /api/products and
// /api/checkout (no real Stripe/Supabase) and asserts (1) the POST body the browser sends
// uses the `cart` key the server reads, and (2) the returned session url drives a redirect.
// This is the integration-level counterpart to the static cart-key contract test; it would
// have caught the `items` vs `cart` mismatch that broke live checkout.
const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/cart.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => {});
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

  await page.locator("#checkoutEmail").fill("buyer@example.com");
  const payBtn = page.getByRole("button", { name: "Card / ACH Checkout" });
  await expect(payBtn).toBeEnabled();
  await payBtn.click();

  await page.waitForURL("**/order-confirmed.html**");

  expect(checkoutBody).not.toBeNull();
  expect(checkoutBody.mode).toBe("pay");
  expect(checkoutBody.email).toBe("buyer@example.com");
  // The line items must travel under `cart` (the key checkout.js reads) — never `items`.
  expect(checkoutBody.cart).toEqual([{ sku: "crhd", qty: 2 }]);
  expect(checkoutBody.items).toBeUndefined();
});
