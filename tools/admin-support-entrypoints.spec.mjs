// Support settings stopped being a sidebar tab: conversations live in the shared
// console, so the two notification prefs hang off that console instead of a
// top-level slot. These prove the entry points still land staff in the inbox —
// the Overview unread count and the settings page's way back in — and that the
// settings destination itself still resolves for deep links and emailed alerts.
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

test("Customer support no longer holds a sidebar slot but stays reachable", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#support-settings`);

  await expect(page.locator('[data-tab="support-settings"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="support-settings"]')).toHaveAttribute("data-active", "true");
  // Prefs load from the API, so the destination is functional, not a husk.
  await expect(page.locator("#adminNotifySupportRequests")).toBeChecked();
  await expect(page.locator("#adminNotifyMessages")).not.toBeChecked();

  // The sidebar must stay in the keyboard tab order even with no tab selected.
  const focusable = await page.locator('.adm-tabs [data-tab][tabindex="0"]').count();
  expect(focusable).toBe(1);
  await expect(page.locator("#admNavCurrent")).toHaveText("Support settings");
});

test("the settings page and Overview's unread count both open the inbox", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#support-settings`);

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeHidden();
  await page.locator("#supportOpenConsole").click();
  await expect(drawer).toBeVisible();
  // Same-document hash navigation does not reload, so close the drawer before
  // reaching for a control it would otherwise cover.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await page.locator('[data-tab="overview"]').click();
  const unread = page.locator('[data-ops-route*="support"]');
  await expect(unread).toContainText("Unread messages");
  await unread.click();
  await expect(drawer).toBeVisible();
  // Opening the inbox must not navigate away from Overview.
  await expect(page.locator('[data-panel="overview"]')).toHaveAttribute("data-active", "true");
});
