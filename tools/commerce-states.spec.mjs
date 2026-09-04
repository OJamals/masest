// Contract spec for the products-grid commerce loading + failure states
// (js/main/commerce-ui.js commerceActionHTML). While the catalog is in flight the
// buy area shows a sized skeleton; if /api/products fails the buy area routes the
// buyer to a quote ("Request pricing") instead of leaving a dead, blank slot.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

const PORT = 4292;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIR = "output/playwright/commerce-states";
let server;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  await waitForHttpServer(`${BASE_URL}/products.html`);
});
test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
});

test("products grid shows a skeleton while loading, then a quote fallback on catalog failure", async ({ page }) => {
  // Delay the catalog response so the loading state is observable, then fail it.
  await page.route("**/api/products", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  // While the catalog request is in flight, purchasable cards show a sized skeleton.
  await expect(page.locator(".shop-card .shop-card-quick-add-loading").first()).toBeVisible();

  // After the failed load settles, the buy area routes to a quote instead of staying blank.
  const fallback = page.locator('.shop-card a.shop-card-quick-add[aria-label^="Request pricing"]');
  await expect(fallback.first()).toBeVisible({ timeout: 5000 });
  await expect(fallback.first()).toHaveAttribute("href", /contact\?type=quote.*#quoteForm$/);
  // No real add-to-cart control rendered when the catalog is unavailable.
  await expect(page.locator(".shop-card [data-commerce-buy]")).toHaveCount(0);
  // The skeletons are gone once the state resolves.
  await expect(page.locator(".shop-card .shop-card-quick-add-loading")).toHaveCount(0);
});

test("zero-result product search offers a contextual chemical-audit handoff", async ({ page }) => {
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.locator("#shopSearch").fill("acetone");

  await expect(page.locator("#shopEmpty")).toBeVisible();
  await expect(page.locator("#shopCount")).toHaveText("No results for “acetone”");

  const handoff = page.locator("#shopEmptyContact");
  await expect(handoff).toBeVisible();
  await expect(handoff).toHaveText("Tell us what you're replacing");
  await expect(handoff).toHaveAttribute(
    "href",
    /contact\?type=audit&message=.*acetone.*#quoteForm$/,
  );

  const reset = page.locator("#shopEmptyReset");
  await expect(reset).toBeVisible();
  await expect(page.locator("#shopEmpty")).toHaveCSS("flex-direction", "column");
  expect(await handoff.evaluate((node) => Boolean(
    node.compareDocumentPosition(document.querySelector("#shopEmptyReset"))
      & Node.DOCUMENT_POSITION_FOLLOWING
  ))).toBe(true);

  const recovery = page.getByRole("button", { name: "Scale & rust" });
  await expect(recovery).toBeVisible();
  await recovery.click();

  const search = page.locator("#shopSearch");
  await expect(search).toHaveValue("scale");
  await expect(search).toBeFocused();
  await expect(page.locator("#shopEmpty")).toBeHidden();
  await expect(page.locator("#shopGrid .shop-card").first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("scale");
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);
});

test("narrow mobile zero-result actions stay clear of customer chat", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(`${BASE_URL}/products.html?q=acetone#catalog`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");

  const reset = page.locator("#shopEmptyReset");
  const contact = page.locator("#shopEmptyContact");
  const chat = page.locator("#customerChat .customer-chat__toggle");
  await expect(reset).toBeVisible();
  await expect(contact).toBeVisible();
  await expect(chat).toBeVisible();

  await page.evaluate(() => {
    const resetBox = document.querySelector("#shopEmptyReset").getBoundingClientRect();
    const chatBox = document.querySelector("#customerChat .customer-chat__toggle").getBoundingClientRect();
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollBy({ top: resetBox.top - chatBox.top - 8, behavior: "instant" });
  });

  const overlapsChat = async (action) => {
    const actionBox = await action.boundingBox();
    const chatBox = await chat.boundingBox();
    if (!actionBox || !chatBox) return true;
    return actionBox.x < chatBox.x + chatBox.width
      && actionBox.x + actionBox.width > chatBox.x
      && actionBox.y < chatBox.y + chatBox.height
      && actionBox.y + actionBox.height > chatBox.y;
  };

  await expect.poll(() => overlapsChat(reset)).toBe(false);
  await expect.poll(() => overlapsChat(contact)).toBe(false);
});

// The success path (real add-to-cart controls when /api/products returns a purchasable
// catalog) is covered by commerce-cart.spec.mjs / product-buy.spec.mjs; the buy markup
// here is unchanged, so this spec only guards the new loading + failure coverage.
