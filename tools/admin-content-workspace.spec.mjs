// Pages and blog posts used to be two sidebar tabs driving one editor module.
// That module mounts into exactly one root and clears the other, so a merged
// workspace has to RE-RENDER on a sub-view switch rather than unhide a cached
// panel. Source-contract tests can pin the markup; only a browser can prove the
// remount actually happens, which is what this spec is for.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";

const PORT = 4318;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
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
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

const entry = (overrides = {}) => ({
  type: "service",
  slug: "water-analysis",
  title: "Water analysis",
  status: "published",
  locale: "en",
  payload: {
    sku: "WATER-ANALYSIS",
    category: "Lab",
    unit: "sample",
    public_price: 100,
    currency: "usd",
    active: true,
  },
  seo: {},
  updated_at: "2026-08-01T12:00:00Z",
  ...overrides,
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
  // Playwright matches routes last-registered-first, so the catch-all goes first
  // and the specific stubs below it actually win.
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ staff_context: { email: "staff@masest.test", role: "owner" } }),
  }));
  await page.route("**/api/admin/content**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      entries: /type=blog_post/.test(route.request().url())
        ? [entry({
            type: "blog_post",
            slug: "descaling-101",
            title: "Descaling 101",
            status: "draft",
            payload: {
              title: "Descaling 101",
              category: "technical",
              date: "2026-08-01",
              excerpt: "Safe industrial descaling.",
              body: "Initial body",
            },
          })]
        : [entry()],
    }),
  }));
}

async function enableStubbedContentEditor(page) {
  await page.locator("#admContent #contentForm").evaluate((form) => {
    form.querySelectorAll("input, textarea, select, button").forEach((control) => {
      control.disabled = false;
      control.removeAttribute("aria-disabled");
      control.removeAttribute("data-permission-disabled");
      control.removeAttribute("title");
    });
  });
}

async function enableStubbedBlogEditor(page) {
  await page.locator("#admBlog #contentForm").evaluate((form) => {
    form.querySelectorAll("input, textarea, select, button").forEach((control) => {
      control.disabled = false;
      control.removeAttribute("aria-disabled");
      control.removeAttribute("data-permission-disabled");
      control.removeAttribute("title");
    });
  });
}

test("Content hosts pages and blog as sub-views, remounting the editor on switch", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html`);
  await page.locator('[data-tab="content"]').click();

  await expect(page.locator('[data-tab="blog"]')).toHaveCount(0);
  await expect(page.locator('[data-content-panel="pages"]')).toBeVisible();
  await expect(page.locator('[data-content-panel="blog"]')).toBeHidden();
  await expect(page.locator("#admContent #contentList")).toBeVisible();

  await page.locator('[data-content-view="blog"]').click();
  await expect(page.locator('[data-content-panel="blog"]')).toBeVisible();
  await expect(page.locator('[data-content-panel="pages"]')).toBeHidden();
  await expect(page.locator('[data-content-view="blog"]')).toHaveAttribute("aria-pressed", "true");
  // The blog editor is mounted with blog data, not just revealed.
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");

  await page.locator('[data-content-view="pages"]').click();
  await expect(page.locator("#admContent #contentList")).toContainText("Water analysis");

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("legacy #blog deep link lands on the blog sub-view", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#blog`);
  await expect(page.locator('[data-panel="content"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator('[data-content-panel="blog"]')).toBeVisible();
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");
  await expect(page).toHaveURL(/#content$/);
});

test("a slow Pages response cannot overwrite Blog after a fast sub-view switch", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/content**");

  let releasePages;
  let markPagesStarted;
  let markPagesFinished;
  const pagesGate = new Promise((resolve) => { releasePages = resolve; });
  const pagesStarted = new Promise((resolve) => { markPagesStarted = resolve; });
  const pagesFinished = new Promise((resolve) => { markPagesFinished = resolve; });

  await page.route("**/api/admin/content**", async (route) => {
    const isBlog = /type=blog_post/.test(route.request().url());
    if (!isBlog) {
      markPagesStarted();
      await pagesGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: isBlog
          ? [entry({ type: "blog_post", slug: "descaling-101", title: "Descaling 101", status: "draft" })]
          : [entry()],
      }),
    });
    if (!isBlog) markPagesFinished();
  });

  await page.goto(`${BASE_URL}/admin.html#content`);
  await pagesStarted;
  await page.locator('[data-content-view="blog"]').click();
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");

  releasePages();
  await pagesFinished;
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");
  await expect(page.locator("#admBlog #contentList")).not.toContainText("Water analysis");
});

test("dirty sub-view switch preserves exact edits on cancel and switches once on confirm", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#content`);
  await page.locator("#admContent [data-content-edit]").first().click();
  await enableStubbedContentEditor(page);
  await page.locator("#admContent #contentTitle").fill("Unsaved exact title");

  await page.locator('[data-content-view="blog"]').click();
  await expect(page.locator("dialog.confirm-dialog")).toContainText("unsaved edits");
  await page.locator('dialog.confirm-dialog button[value="cancel"]').click();
  await expect(page.locator('[data-content-panel="pages"]')).toBeVisible();
  await expect(page.locator("#admContent #contentTitle")).toHaveValue("Unsaved exact title");
  await expect(page.locator('[data-content-view="pages"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator('[data-content-view="blog"]').click();
  await page.locator('dialog.confirm-dialog button[value="confirm"]').click();
  await expect(page.locator('[data-content-panel="blog"]')).toBeVisible();
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");
  await expect(page.locator("dialog.confirm-dialog")).toHaveCount(0);
});

test("late Pages save cannot repaint Blog and duplicate submits are blocked", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/content**");

  let releaseSave;
  let markSaveStarted;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve; });
  let postCount = 0;

  await page.route("**/api/admin/content**", async (route) => {
    const request = route.request();
    const isBlog = /type=blog_post/.test(request.url());
    if (request.method() === "POST") {
      postCount += 1;
      markSaveStarted();
      await saveGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entry: entry({ title: "Saved Pages", version: 2 }) }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: isBlog
          ? [entry({ type: "blog_post", slug: "descaling-101", title: "Descaling 101", status: "draft", version: 1 })]
          : [entry({ status: "draft", version: 1 })],
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#content`);
  await page.locator("#admContent [data-content-edit]").first().click();
  await enableStubbedContentEditor(page);
  await page.locator("#admContent #contentTitle").fill("Saving Pages");
  const saveButton = page.locator('#admContent [data-content-action="draft"]');
  await saveButton.click();
  await saveStarted;
  await expect(saveButton).toBeDisabled();
  await saveButton.click({ force: true });
  expect(postCount).toBe(1);

  await page.locator('[data-content-view="blog"]').click();
  await page.locator('dialog.confirm-dialog button[value="confirm"]').click();
  await expect(page.locator("#admBlog #contentList")).toContainText("Descaling 101");

  releaseSave();
  await expect.poll(() => postCount).toBe(1);
  await expect(page.locator("#admBlog #contentTitle")).not.toHaveValue("Saved Pages");
  await expect(page.locator("#admBlog #contentList")).not.toContainText("Water analysis");
});

test("rich-editor burst typing performs one preview update and uses a concise live status", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#blog`);
  await page.locator("#admBlog [data-content-edit]").first().click();
  await enableStubbedBlogEditor(page);

  const articlePreview = page.locator("#admBlog [data-md-preview-for]");
  await expect(articlePreview).not.toHaveAttribute("aria-live", /.+/);
  await expect(page.locator("#admBlog #contentPreviewStatus")).toHaveAttribute("aria-live", "polite");

  await page.locator("#admBlog #contentPreviewFrame").evaluate((frame) => {
    frame.contentWindow.__masestPreviewMessages = 0;
    frame.contentWindow.addEventListener("message", () => {
      frame.contentWindow.__masestPreviewMessages += 1;
    });
  });
  await page.locator("#admBlog [data-rich-editor-surface]").evaluate((surface) => {
    surface.innerHTML = "<p>Burst preview body</p>";
    for (let index = 0; index < 6; index += 1) {
      surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }
  });

  await expect.poll(() => page.locator("#admBlog #contentPreviewFrame").evaluate((frame) => (
    frame.contentWindow.__masestPreviewMessages
  ))).toBe(1);
  await expect(page.locator("#admBlog [data-rich-editor-output]")).toHaveValue("Burst preview body");
  await expect(page.locator("#admBlog #contentPreviewStatus")).toContainText("Preview updated");
});

test("mobile CMS opens list-first and preserves unsaved edits when returning to posts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#blog`);

  const layout = page.locator("#admBlog .adm-content-layout");
  const editor = page.locator("#admBlog .adm-content-stack");
  const library = page.locator("#admBlog .adm-content-side");
  await expect(layout).toHaveAttribute("data-mobile-view", "list");
  await expect(library).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(page.locator("#admBlog [data-content-mobile-new]")).toBeVisible();

  await page.locator("#admBlog [data-content-edit]").first().click();
  await expect(layout).toHaveAttribute("data-mobile-view", "editor");
  await expect(editor).toBeVisible();
  await expect(library).toBeHidden();
  await expect(page.locator("#admBlog #contentWorkspaceHeading")).toHaveText("Descaling 101");
  await expect(page.locator("#admBlog #contentWorkspaceHeading")).toBeFocused();
  await expect(page.locator("#admBlog [data-content-mobile-back]")).toContainText("Back to posts");

  const tabBounds = await page.locator("#admBlog [data-content-workspace-tab]").evaluateAll((tabs) => (
    tabs.map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { left: rect.left, right: rect.right, height: rect.height };
    })
  ));
  expect(tabBounds).toHaveLength(5);
  for (const bounds of tabBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }

  await enableStubbedBlogEditor(page);
  await page.locator("#admBlog #contentTitle").fill("Unsaved mobile title");
  await page.locator("#admBlog [data-content-mobile-back]").click();
  await expect(layout).toHaveAttribute("data-mobile-view", "list");
  await expect(library).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(page.locator("#admBlog #contentLibraryHeading")).toBeFocused();
  await expect(page.locator("#admBlog #contentTitle")).toHaveValue("Unsaved mobile title");
  await expect(page.locator("dialog.confirm-dialog")).toHaveCount(0);

  await page.locator("#admBlog [data-content-edit]").first().click();
  await expect(layout).toHaveAttribute("data-mobile-view", "editor");
  await expect(page.locator("#admBlog #contentTitle")).toHaveValue("Unsaved mobile title");
  await expect(page.locator("dialog.confirm-dialog")).toHaveCount(0);

  await page.locator("#admBlog [data-content-mobile-back]").click();
  const newButton = page.locator("#admBlog [data-content-mobile-new]");
  await newButton.evaluate((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.removeAttribute("data-permission-disabled");
    button.removeAttribute("title");
  });
  await newButton.click();
  await expect(page.locator("dialog.confirm-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(layout).toHaveAttribute("data-mobile-view", "editor");
  await expect(page.locator("#admBlog #contentTitle")).toHaveValue("Unsaved mobile title");
});

test("mobile Website library can start a clean entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#content`);

  const layout = page.locator("#admContent .adm-content-layout");
  await expect(layout).toHaveAttribute("data-mobile-view", "list");
  const newButton = page.locator("#admContent [data-content-mobile-new]");
  await newButton.evaluate((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.removeAttribute("data-permission-disabled");
    button.removeAttribute("title");
  });
  await newButton.click();
  await expect(layout).toHaveAttribute("data-mobile-view", "editor");
  await expect(page.locator("#admContent #contentWorkspaceHeading")).toHaveText("New content entry");
  await expect(page.locator("#admContent #contentTitle")).toHaveValue("");
});

test("desktop CMS keeps editor and library together without mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#blog`);

  await expect(page.locator("#admBlog .adm-content-stack")).toBeVisible();
  await expect(page.locator("#admBlog .adm-content-side")).toBeVisible();
  await expect(page.locator("#admBlog [data-content-mobile-back]")).toBeHidden();
  await expect(page.locator("#admBlog [data-content-mobile-new]")).toBeHidden();
});
