// Pages and blog posts used to be two sidebar tabs driving one editor module.
// That module mounts into exactly one root and clears the other, so a merged
// workspace has to RE-RENDER on a sub-view switch rather than unhide a cached
// panel. Source-contract tests can pin the markup; only a browser can prove the
// remount actually happens, which is what this spec is for.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

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
  payload: {},
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
        ? [entry({ type: "blog_post", slug: "descaling-101", title: "Descaling 101", status: "draft" })]
        : [entry()],
    }),
  }));
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
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
  // The blog editor is mounted, not just revealed.
  await expect(page.locator("#admBlog #contentList")).toBeVisible();

  await page.locator('[data-content-view="pages"]').click();
  await expect(page.locator("#admContent #contentList")).toBeVisible();

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("legacy #blog deep link lands on the blog sub-view", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#blog`);
  await expect(page.locator('[data-panel="content"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator('[data-content-panel="blog"]')).toBeVisible();
  await expect(page.locator("#admBlog #contentList")).toBeVisible();
  await expect(page).toHaveURL(/#content$/);
});
