// Customer support is an overlay staff carries on every page, not a workspace.
// It has no sidebar tab and no destination page: the notification prefs are a
// view of the console itself. These prove every entry point lands staff in that
// console without leaving the workspace they were in — and that at phone width
// the settings are actually operable, which is the bug that moved them here.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";

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
      staff_context: { email: "staff@masest.test", role: "owner", capabilities: ["admin.write"] },
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

test("at phone width new chat uses the full drawer and keeps order/message fields reachable", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/customers?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      customers: [{
        id: "u1",
        company_id: "c1",
        full_name: "Avery Buyer",
        email: "avery@example.test",
        company_name: "Acme HVAC",
        company_status: "approved",
      }],
    }),
  }));
  await page.route("**/api/admin/users?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      profile: { id: "u1", full_name: "Avery Buyer", email: "avery@example.test" },
      company: { id: "c1", name: "Acme HVAC", status: "approved" },
      orders: [{ id: "o1", order_number: "VK-1001", status: "delivered" }],
    }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/admin.html#support`);

  await page.locator("[data-support-new-chat]").click();
  await expect(page.locator('[data-support-user-id="u1"]')).toBeVisible();
  await page.locator('[data-support-user-id="u1"]').click();
  await expect(page.locator("#siteSupportNewChatOrder")).toHaveValue("");
  await expect(page.locator("#siteSupportNewChatMessage")).toBeVisible();

  const layout = await page.locator(".site-support__drawer").evaluate((drawer) => {
    const conversation = drawer.querySelector(".site-support__conversation");
    const drawerBox = drawer.getBoundingClientRect();
    const conversationBox = conversation.getBoundingClientRect();
    return {
      drawerHeight: drawerBox.height,
      conversationHeight: conversationBox.height,
      unusedBottom: drawerBox.bottom - conversationBox.bottom,
    };
  });
  expect(layout.conversationHeight).toBeGreaterThan(layout.drawerHeight - 3);
  expect(layout.unusedBottom).toBeLessThan(3);
});

test("Accounts user detail opens the same new-chat composer with that user preselected", async ({ page }) => {
  await bootAsStaff(page);
  let customerSearches = 0;
  let userDetailRequests = 0;

  await page.route("**/api/admin/customers**", (route) => {
    customerSearches += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ customers: [] }),
    });
  });
  await page.route("**/api/admin/companies?limit=500", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      companies: [{ id: "c1", name: "Acme HVAC", status: "approved" }],
      total: 1,
      has_more: false,
    }),
  }));
  await page.route("**/api/admin/users?limit=**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      users: [{
        id: "u1",
        company_id: "c1",
        full_name: "Avery Buyer",
        email: "avery@example.test",
        role: "buyer",
        company_name: "Acme HVAC",
        company_status: "approved",
      }],
      total: 1,
      has_more: false,
    }),
  }));
  await page.route("**/api/admin/users?detail=u1", (route) => {
    userDetailRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: { id: "u1", full_name: "Avery Buyer", email: "avery@example.test", role: "buyer" },
        company: { id: "c1", name: "Acme HVAC", status: "approved" },
        addresses: [],
        payment_methods: [],
        orders: [{ id: "o1", order_number: "VK-1001", status: "delivered" }],
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#companies`);
  await page.getByRole("button", { name: "avery@example.test", exact: true }).click();
  await page.getByRole("button", { name: "Start chat" }).click();

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("data-view", "compose");
  await expect(page.locator(".site-support__new-chat-selected")).toContainText("Avery Buyer");
  await expect(page.locator("#siteSupportNewChatOrder option")).toContainText(["General account conversation", "Order VK-1001 · delivered"]);
  await expect(page.locator("#siteSupportNewChatMessage")).toBeFocused();
  expect(customerSearches).toBe(0);
  expect(userDetailRequests).toBeGreaterThanOrEqual(2);
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

test("resolved chats remain recoverable and reopening returns them to Open", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");

  const statuses = new Map([["c1", "open"], ["c2", "complete"], ["c3", "open"]]);
  const requestedViews = [];
  const thread = (companyId) => ({
    company_id: companyId,
    company_name: companyId === "c1" ? "Acme HVAC" : "Northbay Foods",
    last_body: companyId === "c1" ? "Need help today." : "Resolved yesterday.",
    last_at: companyId === "c1" ? "2026-08-30T14:30:00Z" : "2026-08-29T14:30:00Z",
    unanswered: companyId === "c1",
    status: statuses.get(companyId),
  });

  await page.route("**/api/admin/messages**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const companyId = url.searchParams.get("company_id");
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      statuses.set(body.company_id, body.status);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: body.status }) });
      return;
    }
    if (companyId) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          thread: thread(companyId),
          messages: [{ id: `m-${companyId}`, sender_role: "buyer", body: "Customer message", created_at: "2026-08-29T14:30:00Z" }],
        }),
      });
      return;
    }
    if (url.searchParams.get("summary") === "1") {
      const open = [...statuses.values()].filter((status) => status !== "complete").length;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open, unanswered: open } }) });
      return;
    }
    const view = url.searchParams.get("status") || "open";
    requestedViews.push(view);
    const threads = [...statuses.keys()]
      .filter((companyId) => view === "complete" ? statuses.get(companyId) === "complete" : statuses.get(companyId) !== "complete")
      .map(thread);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads }) });
  });

  await page.goto(`${BASE_URL}/admin.html#support`);
  await expect(page.locator('[data-company-id="c1"]')).toBeVisible();
  await expect(page.locator('[data-company-id="c1"] time')).toHaveAttribute("datetime", "2026-08-30T14:30:00Z");

  await page.locator('[data-company-id="c1"]').click();
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.locator('[data-company-id="c1"]')).toHaveCount(0);
  await expect(page.locator(".site-support__conversation-empty h3")).toHaveText("No conversation selected");

  await page.getByRole("button", { name: "Resolved", exact: true }).click();
  await expect(page.locator("#siteSupportTitle")).toHaveText("Resolved chats");
  await expect(page.locator('[data-company-id="c2"]')).toBeVisible();
  expect(requestedViews).toContain("complete");

  await page.locator('[data-company-id="c2"]').click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-company-id="c2"]')).toBeVisible();
  await expect(page.locator(".site-support__conversation-head h3")).toHaveText("Northbay Foods");
});

test("reply drafts survive thread switches and context jumps use canonical admin workspaces", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");
  await page.unroute("**/api/admin/orders**");

  const orderId = "11111111-1111-4111-8111-111111111111";
  const sent = [];
  const detailRequests = [];
  const threads = [
    { company_id: "c1", company_name: "Acme HVAC", last_body: "Order question", last_at: "2026-08-30T14:30:00Z", unanswered: true, status: "open" },
    { company_id: "c2", company_name: "Northbay Foods", last_body: "Second chat", last_at: "2026-08-29T14:30:00Z", unanswered: false, status: "open" },
  ];

  await page.route("**/api/admin/orders**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("id")) {
      detailRequests.push(url.searchParams.get("id"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          order: {
            id: orderId,
            order_number: "SO-42",
            company_id: "c1",
            companies: { name: "Acme HVAC" },
            customer_email: "buyer@example.test",
            status: "cancelled",
            tracking_status: "processing",
            payment_method: "stripe",
            created_at: "2026-08-30T14:00:00Z",
            subtotal: 120,
            total: 120,
            currency: "usd",
            order_items: [],
            shipment_events: [],
            order_provider_links: [],
            order_shipments: [],
            order_financial_entries: [],
          },
          timeline: [],
          integration_timeline: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orders: [{
        id: orderId,
        order_number: "SO-42",
        company_id: "c1",
        companies: { name: "Acme HVAC" },
        status: "cancelled",
        tracking_status: "processing",
        payment_method: "stripe",
        created_at: "2026-08-30T14:00:00Z",
        subtotal: 120,
        total: 120,
        currency: "usd",
        order_items: [],
      }], total: 1, has_more: false }),
    });
  });
  await page.route("**/api/admin/messages**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const companyId = url.searchParams.get("company_id");
    if (request.method() === "POST") {
      sent.push(request.postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "m-new", created_at: "2026-08-30T15:00:00Z" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(companyId ? {
        thread: threads.find((item) => item.company_id === companyId),
        messages: [{
          id: `m-${companyId}`,
          sender_role: "buyer",
          body: `${companyId} message`,
          order_id: companyId === "c1" ? orderId : null,
          order: companyId === "c1" ? {
            id: orderId,
            reference: "SO-42",
            status: "cancelled",
            admin_url: `/admin.html?order=${orderId}#orders`,
          } : null,
          created_at: "2026-08-30T14:30:00Z",
        }],
      } : { threads }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#support`);
  await page.locator('[data-company-id="c1"]').click();
  const reply = page.locator("#siteSupportReply");
  await reply.fill("Saved Acme draft");
  await page.locator('[data-company-id="c2"]').click();
  await page.locator('[data-company-id="c1"]').click();
  await expect(reply).toHaveValue("Saved Acme draft");
  await reply.press("Control+Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ company_id: "c1", body: "Saved Acme draft", order_id: null });
  await expect(reply).toHaveValue("");

  await page.getByRole("link", { name: "View account" }).click();
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator(".site-support__drawer")).toBeHidden();

  await page.locator(".site-support__launcher").click();
  await page.locator('[data-company-id="c1"]').click();
  await page.getByRole("link", { name: "View order SO-42" }).click();
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator("#ordSearch")).toHaveValue(orderId);
  await expect.poll(() => detailRequests).toContain(orderId);
});

test("Admin Orders opens and replies through the order-scoped support conversation", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/orders**");
  await page.unroute("**/api/admin/messages**");

  const orderId = "22222222-2222-4222-8222-222222222222";
  const companyId = "c-order";
  const messageRequests = [];
  const sent = [];
  const order = {
    id: orderId,
    order_number: "MST-2042",
    company_id: companyId,
    companies: { name: "Great Lakes Facilities" },
    customer_email: "buyer@example.test",
    status: "paid",
    tracking_status: "processing",
    payment_method: "stripe",
    created_at: "2026-08-30T14:00:00Z",
    subtotal: 240,
    total: 240,
    currency: "usd",
    order_items: [],
  };
  const orderContext = {
    id: orderId,
    reference: "MST-2042",
    status: "paid",
    admin_url: `/admin.html?order=${orderId}#orders`,
  };

  await page.route("**/api/admin/orders**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "requests") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ requests: [{
          id: "request-1",
          order_id: orderId,
          type: "cancel",
          reason: "Please confirm before shipment.",
          created_at: "2026-08-30T14:15:00Z",
          requested_email: "buyer@example.test",
          orders: order,
        }] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orders: [order], total: 1, has_more: false }),
    });
  });

  await page.route("**/api/admin/messages**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      sent.push(request.postDataJSON());
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "staff-reply", created_at: "2026-08-30T15:00:00Z", order_id: orderId }),
      });
    }
    if (url.searchParams.get("summary") === "1") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: { open: 1, unanswered: 1 } }),
      });
    }
    messageRequests.push(url.search);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread: {
          company_id: companyId,
          company_name: "Great Lakes Facilities",
          status: "open",
          order_scope: orderContext,
        },
        messages: [{
          id: "buyer-question",
          sender_role: "buyer",
          body: "Can this ship Friday?",
          order_id: orderId,
          order: orderContext,
          created_at: "2026-08-30T14:30:00Z",
        }],
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#orders`);
  const orderCard = page.locator(".admin-order-card").filter({ hasText: "MST-2042" });
  await expect(orderCard).toBeVisible();
  await orderCard.getByRole("button", { name: "Message customer" }).click();

  await expect(page.locator(".site-support__drawer")).toBeVisible();
  await expect(page.locator(".site-support__conversation-head h3")).toHaveText("Great Lakes Facilities");
  await expect(page.locator(".site-support__order-scope")).toContainText("Replying about order MST-2042");
  await expect.poll(() => messageRequests.some((search) => (
    search.includes(`company_id=${companyId}`) && search.includes(`order_id=${orderId}`)
  ))).toBe(true);

  const reply = page.locator("#siteSupportReply");
  await reply.fill("Friday shipment confirmed.");
  await reply.press("Control+Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    company_id: companyId,
    body: "Friday shipment confirmed.",
    order_id: orderId,
  });
});

test("support list load failures offer an in-place retry", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/messages**");
  let available = false;
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 0, unanswered: 0 } }) });
    }
    if (!available) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threads: [{ company_id: "c1", company_name: "Acme HVAC", last_body: "Need help", last_at: "2026-08-30T14:30:00Z", unanswered: true, status: "open" }] }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#support`);
  const retry = page.getByRole("button", { name: "Retry loading support" });
  await expect(retry).toBeVisible();
  available = true;
  await retry.click();
  await expect(page.locator('[data-company-id="c1"]')).toBeVisible();
});
