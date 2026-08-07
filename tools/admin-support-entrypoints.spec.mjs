// Customer support is an overlay staff carries on every page, not a workspace.
// It has no sidebar tab and no destination page: the notification prefs are a
// view of the console itself. These prove every entry point lands staff in that
// console without leaving the workspace they were in — and that at phone width
// the settings are actually operable, which is the bug that moved them here.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4319;
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
    body: JSON.stringify({
      staff_context: { email: "staff@masest.test", role: "owner" },
      crm: { unread_messages: 3 },
    }),
  }));
  await page.route("**/api/admin/message-settings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ notify_admin_support_requests: true, notify_admin_messages: false }),
  }));
  await page.route("**/api/admin/messages**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ threads: [] }),
  }));
}

test("#support-settings opens the console on its settings view, not a page", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#support-settings`);

  // Neither a tab nor a panel — the whole destination is gone.
  await expect(page.locator('[data-tab="support-settings"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="support-settings"]')).toHaveCount(0);

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("data-view", "settings");
  // Prefs load from the API, so this is a functional view, not a husk.
  await expect(page.locator("#adminNotifySupportRequests")).toBeChecked();
  await expect(page.locator("#adminNotifyMessages")).not.toBeChecked();

  // Staff keep the workspace they were on; support opens over it.
  await expect(page.locator('[data-panel="overview"]')).toHaveAttribute("data-active", "true");
  const focusable = await page.locator('.adm-tabs [data-tab][tabindex="0"]').count();
  expect(focusable).toBe(1);
});

test("the gear toggles settings and the back arrow returns to conversations", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#support`);

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("data-view", "inbox");

  await page.locator("[data-support-settings-toggle]").click();
  await expect(drawer).toHaveAttribute("data-view", "settings");
  await expect(page.locator("[data-support-settings-toggle]")).toHaveAttribute("aria-expanded", "true");

  await page.locator("[data-support-back]").click();
  await expect(drawer).toHaveAttribute("data-view", "inbox");
  await expect(page.locator("[data-support-back]")).toBeHidden();
  // Escape from the inbox closes the drawer rather than only backing out a view.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("at phone width the settings are operable, not covered by the drawer", async ({ page }) => {
  await bootAsStaff(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/admin.html#support-settings`);

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeVisible();
  // The thread list would otherwise squeeze the prefs into an unusable strip.
  await expect(page.locator(".site-support__list-pane")).toBeHidden();

  // This is the regression: the click only lands if nothing is over the control.
  // It used to be the drawer itself, covering the page the gear navigated to.
  const pref = page.locator("#adminNotifySupportRequests");
  await expect(pref).toBeChecked();
  await pref.click();
  await expect(pref).not.toBeChecked();
  await expect(page.locator(".site-support__settings-status")).toHaveText("Saved.");
});

test("at phone width the stacked panes fill the drawer with no dead band", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      threads: [
        { company_id: "c1", company_name: "Acme HVAC", last_body: "Chiller loop is fouling again.", last_at: "2026-08-07T10:00:00Z", unanswered: true, status: "open" },
        { company_id: "c2", company_name: "Northbay", last_body: "Thanks, received.", last_at: "2026-08-06T10:00:00Z", unanswered: false, status: "open" },
      ],
    }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/admin.html#support`);
  await page.waitForSelector(".site-support__drawer:not([hidden])");
  await expect(page.locator(".site-support__thread")).toHaveCount(2);

  const box = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const drawer = rect(".site-support__drawer");
    const listPane = rect(".site-support__list-pane");
    const conversation = rect(".site-support__conversation");
    const threads = document.querySelector(".site-support__threads");
    return {
      gap: Math.round(conversation.top - listPane.bottom),
      slack: Math.round(drawer.bottom - conversation.bottom),
      listShare: listPane.height / drawer.height,
      threadsClipped: threads.scrollHeight - threads.clientHeight,
    };
  });

  // Implicit auto rows used to split the drawer's spare height between the two
  // panes, stranding a ~220px band above the conversation and clipping the list.
  expect(box.gap).toBe(0);
  expect(box.slack).toBeLessThanOrEqual(1);
  // A short list keeps its own height; it may never eat more than the 42% cap.
  expect(box.listShare).toBeLessThanOrEqual(0.43);
  expect(box.threadsClipped).toBe(0);
});

test("Overview's unread count opens the inbox without leaving Overview", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#overview`);

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeHidden();

  const unread = page.locator('[data-ops-route*="support"]');
  await expect(unread).toContainText("Unread messages");
  await unread.click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("data-view", "inbox");
  await expect(page.locator('[data-panel="overview"]')).toHaveAttribute("data-active", "true");
});

test("a [data-support-open] link opens the console in place instead of navigating", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#orders`);
  await expect(page.locator(".site-support__launcher")).toBeVisible();

  // Stands in for the staff account menu on a public page: same attribute, same
  // handler. The href must NOT be followed while the console is mounted.
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/admin.html#support";
    link.dataset.supportOpen = "";
    link.id = "staffMenuSupportProbe";
    link.textContent = "Customer support";
    document.body.append(link);
  });
  await page.locator("#staffMenuSupportProbe").click();

  await expect(page.locator(".site-support__drawer")).toBeVisible();
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
});
