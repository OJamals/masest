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
  await expect(page.locator('[data-content-seo-field="description"]')).toHaveValue("Industrial water analysis.");
  await page.locator('[data-content-payload-field="public_price"]').fill("130.25");
  await page.locator('[data-content-payload-field="active"]').uncheck();
  await page.locator('[data-content-seo-field="title"]').fill("Industrial water analysis | MASEST");
  await page.locator('[data-content-seo-field="description"]').fill("Industrial water analysis for field teams replacing legacy service calls.");
  await page.locator('[data-content-seo-field="og_image"]').fill("img/proof/cases/water-analysis.webp");
  await expect(page.locator("#contentSeo")).toHaveValue(/Industrial water analysis \| MASEST/);
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
  expect(saveBody.entry.seo.title).toBe("Industrial water analysis | MASEST");
  expect(saveBody.entry.seo.description).toBe("Industrial water analysis for field teams replacing legacy service calls.");
  expect(saveBody.entry.seo.og_image).toBe("img/proof/cases/water-analysis.webp");
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

test("content editor duplicates entries as collision-safe drafts", async ({ page }) => {
  await bootAsStaff(page);

  let saveBody = null;
  const entries = [
    contentList().entries[0],
    {
      ...contentList().entries[0],
      slug: "water-analysis-copy",
      title: "Water analysis copy",
      status: "draft",
    },
  ];
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      saveBody = req.postDataJSON();
      const saved = { ...saveBody.entry, status: saveBody.publish ? "published" : "draft" };
      entries.push(saved);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry: saved }),
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

  await page.locator('[data-content-action="duplicate"]').click();
  await expect(page.locator("#contentEditorBadge")).toHaveText("draft");
  await expect(page.locator("#contentTitle")).toHaveValue("Water analysis copy");
  await expect(page.locator("#contentSlug")).toHaveValue("water-analysis-copy-2");
  await expect(page.locator("#contentStatus")).toHaveText("Duplicated as a new draft. Review the slug, then save.");
  expect(saveBody).toBeNull();
  await page.locator("#contentForm .adm-inline-actions").screenshot({
    path: `${SCREENSHOT_DIR}/admin-content-duplicate-draft-desktop.png`,
  });

  const saveResponse = page.waitForResponse((response) => (
    response.url().includes("/api/admin/content") && response.request().method() === "POST"
  ));
  await page.locator('[data-content-action="draft"]').click();
  await saveResponse;

  expect(saveBody.publish).toBe(false);
  expect(saveBody.entry.slug).toBe("water-analysis-copy-2");
  expect(saveBody.entry.title).toBe("Water analysis copy");
  expect(saveBody.entry.payload.sku).toBe("MS-LAB-WATER");
  await expect(page.locator("#contentStatus")).toHaveText("Draft saved.");
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

test("content operations publishes due scheduled entries in batch", async ({ page }) => {
  await bootAsStaff(page);

  let publishScheduledBody = null;
  let entries = contentList().entries.map((entry) => ({
    ...entry,
    status: "scheduled",
    scheduled_at: "2026-06-30T13:00:00.000Z",
    review_note: "Ready after final compliance approval.",
  }));
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      publishScheduledBody = req.postDataJSON();
      entries = entries.map((entry) => ({
        ...entry,
        status: "published",
        scheduled_at: null,
        published_at: "2026-06-30T13:01:00.000Z",
      }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          count: entries.length,
          entries,
          publish_hook: { ok: true, skipped: false, status: 200 },
        }),
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
  await expect(page.locator("#contentWorkflowRows")).toContainText("Water analysis");
  await expect(page.locator("#contentWorkflowRows")).toContainText("Ready after final compliance approval.");
  await page.locator("#contentWorkflowQueue").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -88));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-scheduled-batch-desktop.png` });

  const publishResponse = page.waitForResponse((response) => (
    response.url().includes("/api/admin/content") && response.request().method() === "POST"
  ));
  await page.locator('[data-content-action="publish_scheduled"]').click();
  await publishResponse;

  expect(publishScheduledBody.action).toBe("publish_scheduled");
  await expect(page.locator("#contentStatus")).toHaveText("Published 1 scheduled item. Static rebuild triggered.");
  await expect(page.locator("#contentList")).toContainText("Water analysis");
  await expect(page.locator("#contentWorkflowRows")).not.toContainText("Ready after final compliance approval.");
});

test("content editor sends workflow notes and surfaces review notes", async ({ page }) => {
  await bootAsStaff(page);

  let workflowBody = null;
  let entries = contentList().entries;
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      workflowBody = req.postDataJSON();
      const workflowEntry = {
        ...workflowBody.entry,
        status: "changes_requested",
        review_note: workflowBody.note,
      };
      entries = [workflowEntry];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry: workflowEntry }),
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

  const note = "Tighten the compliance wording before publishing.";
  await expect(page.locator("#contentWorkflowNote")).toBeVisible();
  await page.locator("#contentWorkflowNote").fill(note);

  const workflowResponse = page.waitForResponse((response) => (
    response.url().includes("/api/admin/content") && response.request().method() === "POST"
  ));
  await page.locator('[data-content-workflow="request_changes"]').click();
  await workflowResponse;

  expect(workflowBody.action).toBe("request_changes");
  expect(workflowBody.note).toBe(note);
  await expect(page.locator("#contentWorkflowNote")).toHaveValue(note);
  await expect(page.locator("#contentWorkflowRows")).toContainText("Water analysis");
  await expect(page.locator("#contentWorkflowRows")).toContainText(note);
});

test("content editor blocks writes behind active editorial locks", async ({ page }) => {
  await bootAsStaff(page);

  const posts = [];
  let entry = {
    ...contentList().entries[0],
    locked_by: "other-editor",
    locked_at: new Date().toISOString(),
  };
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      posts.push(body);
      if (body.action === "force_unlock") {
        entry = { ...entry, locked_by: null, locked_at: null };
      } else if (body.action === "lock") {
        entry = { ...entry, locked_by: "staff-user", locked_at: new Date().toISOString() };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry }),
      });
    }
    const url = new URL(req.url());
    const status = url.searchParams.get("status") || "published";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: status === "all" || entry.status === status ? [entry] : [] }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator("[data-content-edit]").first().click();

  await expect(page.locator("#contentLockStatus")).toContainText("Locked by another editor");
  await expect(page.locator('[data-content-action="draft"]')).toBeDisabled();
  await expect(page.locator('[data-content-workflow="submit_review"]')).toBeDisabled();
  await expect(page.locator('[data-content-action="force_unlock"]')).toBeEnabled();
  await scrollContentPanelIntoView(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-locks-desktop.png` });

  await page.locator('[data-content-action="force_unlock"]').click();
  await expect(page.locator("#contentStatus")).toHaveText("Lock released.");
  expect(posts.at(-1).action).toBe("force_unlock");
  await expect(page.locator("#contentLockStatus")).toHaveText("Unlocked");
  await expect(page.locator('[data-content-action="draft"]')).toBeEnabled();

  await page.locator('[data-content-action="lock"]').click();
  await expect(page.locator("#contentStatus")).toHaveText("Lock claimed.");
  expect(posts.at(-1).action).toBe("lock");
  await expect(page.locator("#contentLockStatus")).toContainText("Locked by you");
  await expect(page.locator('[data-content-action="unlock"]')).toBeEnabled();
  await expect(page.locator('[data-content-action="force_unlock"]')).toBeDisabled();
});

test("content editor restores archived entries back to draft", async ({ page }) => {
  await bootAsStaff(page);

  let restoreBody = null;
  let entry = {
    ...contentList().entries[0],
    status: "archived",
    published_at: "2026-06-25T12:00:00.000Z",
    review_note: "Archived after old campaign sunset.",
  };
  await page.route("**/api/admin/content**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      restoreBody = req.postDataJSON();
      if (restoreBody.action === "unarchive") {
        entry = {
          ...entry,
          status: "draft",
          published_at: null,
          review_note: null,
        };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entry }),
      });
    }
    const url = new URL(req.url());
    const status = url.searchParams.get("status") || "published";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: status === "all" || entry.status === status ? [entry] : [] }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator("#contentStatusFilter").selectOption("archived");
  await page.locator("[data-content-edit]").first().click();

  await expect(page.locator("#contentEditorBadge")).toHaveText("archived");
  await expect(page.locator('[data-content-action="archive"]')).toBeHidden();
  await expect(page.locator('[data-content-action="unarchive"]')).toBeVisible();
  await page.locator("#contentForm .adm-inline-actions").screenshot({
    path: `${SCREENSHOT_DIR}/admin-content-archived-restore-desktop.png`,
  });

  const restoreResponse = page.waitForResponse((response) => (
    response.url().includes("/api/admin/content") && response.request().method() === "POST"
  ));
  await page.locator('[data-content-action="unarchive"]').click();
  await restoreResponse;

  expect(restoreBody.action).toBe("unarchive");
  expect(restoreBody.entry).toMatchObject({ type: "service", slug: "water-analysis", locale: "en" });
  await expect(page.locator("#contentStatus")).toHaveText("Restored as draft.");
  await expect(page.locator("#contentEditorBadge")).toHaveText("draft");
  await expect(page.locator('[data-content-action="archive"]')).toBeVisible();
  await expect(page.locator('[data-content-action="unarchive"]')).toBeHidden();
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
  await page.locator("#contentWorkflowQueue").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -88));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-operations-mobile.png` });
});
