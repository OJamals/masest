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

test("content editor auto-generates slugs while preserving manual overrides", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/content**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(contentList()),
  }));

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator("#contentSlug")).toHaveValue("");

  await page.locator("#contentTitle").fill("Cooling Tower & CIP: Before/After!");
  await expect(page.locator("#contentSlug")).toHaveValue("cooling-tower-and-cip-before-after");

  await page.locator("#contentSlug").fill("Custom Case Study");
  await expect(page.locator("#contentSlug")).toHaveValue("custom-case-study");
  await page.locator("#contentTitle").fill("Changed title should not replace the slug");
  await expect(page.locator("#contentSlug")).toHaveValue("custom-case-study");

  await page.locator('[data-content-action="new"]').click();
  await expect(page.locator("#contentSlug")).toHaveValue("");
  await page.locator("#contentTitle").fill("Raw Water Pilot Trial #2");
  await expect(page.locator("#contentSlug")).toHaveValue("raw-water-pilot-trial-2");
});

test("content editor schedules publish with an explicit datetime", async ({ page }) => {
  await bootAsStaff(page);

  let scheduledBody = null;
  let entries = contentList().entries;
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      scheduledBody = req.postDataJSON();
      const scheduledEntry = { ...scheduledBody.entry, status: "scheduled" };
      entries = [scheduledEntry];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry: scheduledEntry }),
      });
    }
    const url = new URL(req.url());
    const status = url.searchParams.get("status") || "published";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: status === "all" ? entries : entries.filter((entry) => entry.status === status) }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator("[data-content-edit]").first().click();

  await expect(page.locator("#contentScheduledAt")).toBeVisible();
  await page.locator("#contentScheduledAt").fill("2026-07-01T09:30");
  const expectedScheduledAt = await page.locator("#contentScheduledAt").evaluate((input) => new Date(input.value).toISOString());

  const scheduleResponse = page.waitForResponse((response) => (
    response.url().includes("/api/admin/content") && response.request().method() === "POST"
  ));
  await page.locator('[data-content-workflow="schedule"]').click();
  await scheduleResponse;

  expect(scheduledBody.action).toBe("schedule");
  expect(scheduledBody.entry.scheduled_at).toBe(expectedScheduledAt);
  await expect(page.locator("#contentStatus")).toHaveText("Workflow updated: schedule.");
  await expect(page.locator("#contentWorkflowRows")).toContainText("Water analysis");
  await expect(page.locator("#contentWorkflowRows")).toContainText("Scheduled for");
});

test("content editor requires a datetime before scheduling publish", async ({ page }) => {
  await bootAsStaff(page);

  let postCount = 0;
  await page.route("**/api/admin/content**", async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry: { ...route.request().postDataJSON().entry, status: "scheduled" } }),
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
  await page.locator("[data-content-edit]").first().click();
  await expect(page.locator("#contentScheduledAt")).toHaveValue("");

  await page.locator('[data-content-workflow="schedule"]').click();
  await expect(page.locator("#contentStatus")).toHaveText("Choose a publish date before scheduling.");
  expect(postCount).toBe(0);
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
