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
  await page.route("**/api/admin/messages**", (route) => {
    const summary = new URL(route.request().url()).searchParams.get("summary") === "1";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summary ? { summary: { open: 0, unanswered: 0 } } : { threads: [] }),
    });
  });
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

test("at phone width support moves from the full inbox to a full conversation", async ({ page }) => {
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

  const drawer = page.locator(".site-support__drawer");
  const listPane = page.locator(".site-support__list-pane");
  const conversation = page.locator(".site-support__conversation");
  await expect(drawer).toHaveAttribute("data-thread-selected", "false");
  await expect(listPane).toBeVisible();
  await expect(conversation).toBeHidden();
  await expect(page.locator(".site-support__launcher i")).toHaveClass(/ph-x/);

  await page.locator('[data-company-id="c1"]').click();
  await expect(drawer).toHaveAttribute("data-thread-selected", "true");
  await expect(listPane).toBeHidden();
  await expect(conversation).toBeVisible();
  await expect(page.locator(".site-support__conversation-head h3")).toHaveText("Acme HVAC");
  await expect(page.locator("[data-support-back]")).toBeVisible();

  await page.locator("[data-support-back]").click();
  await expect(drawer).toHaveAttribute("data-thread-selected", "false");
  await expect(listPane).toBeVisible();
  await expect(conversation).toBeHidden();
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

test("support search filters by customer and recent message without hiding the inbox count", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      threads: [
        { company_id: "c1", company_name: "Acme HVAC", last_body: "Chiller loop is fouling again.", last_at: "2026-08-07T10:00:00Z", unanswered: true, status: "open" },
        { company_id: "c2", company_name: "Northbay Foods", last_body: "Thanks, received.", last_at: "2026-08-06T10:00:00Z", unanswered: false, status: "open" },
      ],
    }),
  }));
  await page.goto(`${BASE_URL}/admin.html#support`);

  const search = page.getByRole("searchbox", { name: "Search customer chats" });
  await search.fill("received");
  await expect(page.locator(".site-support__thread")).toHaveCount(1);
  await expect(page.locator(".site-support__thread")).toContainText("Northbay Foods");
  await expect(page.locator("[data-support-results]")).toHaveText("1 of 2 chats shown");
  await expect(page.locator("[data-support-summary]")).toHaveText("1 chat needs a reply");

  await search.fill("no match");
  await expect(page.locator(".site-support__thread")).toHaveCount(0);
  await expect(page.locator("[data-support-results]")).toHaveText("No chats match your search");
});

test("the latest conversation request wins when staff switch threads quickly", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");

  let releaseSlow;
  let markSlowStarted;
  let markSlowFinished;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const slowStarted = new Promise((resolve) => { markSlowStarted = resolve; });
  const slowFinished = new Promise((resolve) => { markSlowFinished = resolve; });
  const threads = [
    { company_id: "c1", company_name: "Acme HVAC", last_body: "First thread", last_at: "2026-08-07T10:00:00Z", unanswered: true, status: "open" },
    { company_id: "c2", company_name: "Northbay Foods", last_body: "Second thread", last_at: "2026-08-06T10:00:00Z", unanswered: false, status: "open" },
  ];

  await page.route("**/api/admin/messages**", async (route) => {
    const companyId = new URL(route.request().url()).searchParams.get("company_id");
    if (!companyId) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads }) });
      return;
    }
    if (companyId === "c1") {
      markSlowStarted();
      await slowGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread: threads.find((thread) => thread.company_id === companyId),
        messages: [{ id: companyId, sender_role: "buyer", body: `${companyId} message`, created_at: "2026-08-07T10:00:00Z" }],
      }),
    });
    if (companyId === "c1") markSlowFinished();
  });

  await page.goto(`${BASE_URL}/admin.html#support`);
  await expect(page.locator(".site-support__thread")).toHaveCount(2);
  await page.locator('[data-company-id="c1"]').click();
  await slowStarted;
  await page.locator('[data-company-id="c2"]').click();
  await expect(page.locator(".site-support__conversation-head h3")).toHaveText("Northbay Foods");
  await expect(page.locator(".site-support__messages")).toContainText("c2 message");

  releaseSlow();
  await slowFinished;
  await expect(page.locator(".site-support__conversation-head h3")).toHaveText("Northbay Foods");
  await expect(page.locator(".site-support__messages")).toContainText("c2 message");
});

test("the latest inbox refresh wins when an older list response arrives late", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");

  let releaseSlow;
  let markSlowStarted;
  let markSlowFinished;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const slowStarted = new Promise((resolve) => { markSlowStarted = resolve; });
  const slowFinished = new Promise((resolve) => { markSlowFinished = resolve; });
  let listRequest = 0;

  await page.route("**/api/admin/messages**", async (route) => {
    const requestNumber = ++listRequest;
    if (requestNumber === 2) {
      markSlowStarted();
      await slowGate;
    }
    const snapshot = requestNumber === 1 ? "Initial snapshot"
      : requestNumber === 2 ? "Old snapshot"
        : "Fresh snapshot";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threads: [{
          company_id: snapshot.toLocaleLowerCase().split(" ")[0],
          company_name: snapshot,
          last_body: "Support request",
          last_at: "2026-08-07T10:00:00Z",
          unanswered: true,
          status: "open",
        }],
      }),
    });
    if (requestNumber === 2) markSlowFinished();
  });

  await page.goto(`${BASE_URL}/admin.html#support`);
  await slowStarted;
  await page.locator(".site-support__launcher").click();
  await page.locator(".site-support__launcher").click();
  await expect(page.locator(".site-support__thread")).toContainText("Fresh snapshot");

  releaseSlow();
  await slowFinished;
  await expect(page.locator(".site-support__thread")).toContainText("Fresh snapshot");
  await expect(page.locator(".site-support__thread")).not.toContainText("Old snapshot");
});

test("closed support fetches only counts, open support fetches threads, and hidden pages stop", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");
  const requests = [];
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    const summary = url.searchParams.get("summary") === "1";
    requests.push(summary ? "summary" : "threads");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summary
        ? { summary: { open: 4, unanswered: 2 } }
        : { threads: [{ company_id: "c1", company_name: "Acme HVAC", last_body: "Need help", last_at: "2026-08-07T10:00:00Z", unanswered: true, status: "open" }] }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#overview`);
  await expect.poll(() => requests.filter((kind) => kind === "summary").length).toBeGreaterThan(0);
  expect(requests).not.toContain("threads");
  await expect(page.locator("[data-support-count]")).toHaveText("2");

  await page.locator(".site-support__launcher").click();
  await expect.poll(() => requests.filter((kind) => kind === "threads").length).toBeGreaterThan(0);
  await expect(page.locator(".site-support__thread")).toHaveCount(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenRequestCount = requests.length;
  await page.waitForTimeout(100);
  expect(requests).toHaveLength(hiddenRequestCount);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests.length).toBeGreaterThan(hiddenRequestCount);
  expect(requests.at(-1)).toBe("threads");
});
