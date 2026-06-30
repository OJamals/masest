// Contract spec for the products-grid commerce loading + failure states
// (js/main/commerce-ui.js commerceActionHTML). While the catalog is in flight the
// buy area shows a sized skeleton; if /api/products fails the buy area routes the
// buyer to a quote ("Request pricing") instead of leaving a dead, blank slot.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4292;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIR = "output/playwright/commerce-states";
let server;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${BASE_URL}/products.html`).catch(() => null);
    if (r?.ok) return;
    await new Promise((res) => setTimeout(res, 125));
  }
  throw new Error("static server did not start");
});
test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  // The test host is 127.0.0.1, where commerce is auto-suppressed; opt back in so the
  // buy controls (and their loading/failure states) actually render.
  await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
});

test("products grid shows a skeleton while loading, then a quote fallback on catalog failure", async ({ page }) => {
  // Delay the catalog response so the loading state is observable, then fail it.
  await page.route("**/api/products", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  // While the catalog request is in flight, purchasable cards show a sized skeleton.
  await expect(page.locator(".shop-card .commerce-skeleton").first()).toBeVisible();

  // After the failed load settles, the buy area routes to a quote instead of staying blank.
  const fallback = page.locator(".shop-card .commerce-quote-fallback");
  await expect(fallback.first()).toBeVisible({ timeout: 5000 });
  await expect(fallback.first()).toHaveAttribute("href", /contact\?type=quote/);
  // No real add-to-cart control rendered when the catalog is unavailable.
  await expect(page.locator(".shop-card [data-commerce-buy]")).toHaveCount(0);
  // The skeletons are gone once the state resolves.
  await expect(page.locator(".shop-card .commerce-skeleton")).toHaveCount(0);
});

// The success path (real add-to-cart controls when /api/products returns a purchasable
// catalog) is covered by commerce-cart.spec.mjs / product-buy.spec.mjs; the buy markup
// here is unchanged, so this spec only guards the new loading + failure coverage.
