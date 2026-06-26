import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = "output/playwright/cms-expansion";
let server;

test.beforeAll(async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([
    exitedOnce,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

async function bootAsStaff(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
}

function contentList() {
  return {
    entries: [{
      type: "service",
      slug: "water-analysis",
      title: "Water analysis",
      status: "published",
      locale: "en",
      payload: {
        sku: "MS-LAB-WATER",
        category: "Lab",
        unit: "sample",
        public_price: 125,
        currency: "usd",
        active: true,
      },
      seo: { description: "Industrial water analysis." },
      updated_at: "2026-06-25T12:00:00Z",
    }],
  };
}

async function scrollContentPanelIntoView(page) {
  await page.locator("#admContent").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -88));
}

test("staff edits structured CMS service fields and posts normalized payload", async ({ page }) => {
  await bootAsStaff(page);

  let saveBody = null;
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      saveBody = req.postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry: { ...saveBody.entry, status: saveBody.publish ? "published" : "draft" } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contentList()),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator("#contentStructuredFields")).toBeVisible();
  await page.locator("[data-content-edit]").first().click();

  await expect(page.locator('[data-content-payload-field="sku"]')).toHaveValue("MS-LAB-WATER");
  await page.locator('[data-content-payload-field="public_price"]').fill("130.25");
  await page.locator('[data-content-payload-field="active"]').uncheck();
  await page.locator('[data-content-action="preview"]').click();

  const frame = page.frameLocator("#contentPreviewFrame");
  await expect(frame.locator("h1")).toContainText("Water analysis");
  await expect(frame.locator("pre")).toContainText("130.25");

  const saveResponse = page.waitForResponse((response) => response.url().includes("/api/admin/content") && response.request().method() === "POST");
  await page.locator('[data-content-action="draft"]').click();
  await saveResponse;

  expect(saveBody.publish).toBe(false);
  expect(saveBody.entry.type).toBe("service");
  expect(saveBody.entry.payload.public_price).toBe(130.25);
  expect(saveBody.entry.payload.active).toBe(false);
  await expect(page.locator("#contentStatus")).toHaveText("Draft saved.");
  await scrollContentPanelIntoView(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-structured-desktop.png` });
});

test("mobile content editor switches to page metadata fields without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootAsStaff(page);
  await page.route("**/api/admin/content**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(contentList()),
  }));

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator("#contentType").selectOption("page_meta");
  await expect(page.locator('[data-content-payload-field="page"]')).toBeVisible();
  await expect(page.locator('[data-content-payload-field="description"]')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await scrollContentPanelIntoView(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-structured-mobile.png` });
});
