import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";
import { createSupportPoller } from "../js/admin-support.js";

const PORT = 4319;
const BASE_URL = "http://127.0.0.1:" + PORT;
const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(BASE_URL + "/admin.html");
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

const ticket = (overrides = {}) => ({
  id: TICKET_ID,
  display_number: "MAS-000042",
  subject: "Damaged pail on delivery",
  status: "open",
  priority: "high",
  category: "order",
  version: 4,
  assigned_to: null,
  participant: { id: USER_ID, name: "Avery Buyer" },
  company: { id: "company-1", name: "Acme HVAC" },
  last_message_at: "2026-09-06T14:00:00Z",
  order: { id: ORDER_ID, reference: "MST-2042", status: "delivered", admin_url: "/admin.html?order=" + ORDER_ID + "#orders" },
  ...overrides,
});

const detailTicket = (overrides = {}) => {
  const { participant, company, ...plainTicket } = ticket(overrides);
  return plainTicket;
};

async function boot(page, { post = null, onList = null, onDetail = null, role = "owner" } = {}) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route("**/api/admin/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ staff_context: { email: "staff@masest.test", role, capabilities: role === "read_only" ? [] : ["admin.write"] }, crm: { unread_messages: 1 } }),
  }));
  await page.route("**/api/admin/message-settings", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ notify_admin_support_requests: true, notify_admin_messages: false }),
  }));
  await page.route("**/api/admin/customers?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ customers: [{ id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test", company_name: "Acme HVAC" }] }),
  }));
  await page.route("**/api/admin/users?detail=**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      profile: { id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test" },
      company: { id: "company-1", name: "Acme HVAC" },
      orders: [{ id: ORDER_ID, order_number: "MST-2042", status: "delivered" }],
    }),
  }));
  await page.route("**/api/admin/messages**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      if (post) return post(route);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket_id: TICKET_ID, ticket: ticket() }) });
    }
    if (request.method() === "PATCH") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ priority: "urgent", version: 5 }) }) });
    }
    if (url.searchParams.get("summary") === "1") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1, mine: 0, unassigned: 1, waiting: 0, resolved: 0 } }) });
    }
    if (url.searchParams.get("view") === "assignees") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [{ id: "staff-1", name: "Morgan Support", role: "support" }] }) });
    }
    if (url.searchParams.get("ticket_id")) {
      if (onDetail) onDetail(url);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          ticket: detailTicket(),
          thread: { id: "thread-1", participant: { id: USER_ID, full_name: "Avery Buyer" }, company_id: "company-1", company_name: "Acme HVAC" },
          order_scope: { id: ORDER_ID, reference: "MST-2042", status: "delivered", admin_url: "/admin.html?order=" + ORDER_ID + "#orders" },
          messages: [{ id: "m1", sender_role: "buyer", body: "One pail arrived damaged.", created_at: "2026-09-06T14:00:00Z" }],
          has_more: false, next_message_cursor: null,
        }),
      });
    }
    if (onList) onList(url);
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ tickets: [ticket()], summary: { open: 2, needs_reply: 1, mine: 0, unassigned: 1, waiting: 0, resolved: 0 }, has_more: false, next_cursor: null }),
    });
  });
}

async function wireRealAdminEntrypoints(page, {
  orders = [],
  users = [],
  company = null,
  companyTickets = [],
  listTickets = [ticket()],
  onMessageList = null,
} = {}) {
  await page.route("**/api/admin/orders**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "requests") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders, total: orders.length, has_more: false }) });
  });
  await page.route("**/api/admin/companies**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ companies: company ? [company] : [], total: company ? 1 : 0, has_more: false }),
  }));
  await page.route("**/api/admin/company?**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ company: company || {}, members: [], orders: [], message_count: 0 }),
  }));
  await page.route("**/api/admin/users**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("company")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ addresses: [], orders: [], payment_methods: [] }) });
    const id = url.searchParams.get("detail");
    const profile = users.find((user) => user.id === id) || users[0] || { id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test" };
    if (id) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile, company: company || { id: "company-1", name: "Acme HVAC" }, orders: [{ id: ORDER_ID, order_number: "MST-2042", status: "delivered" }] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users, total: users.length, has_more: false }) });
  });
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1, mine: 0, unassigned: 1, waiting: 0, resolved: 0 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (request.method() === "POST") return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket_id: TICKET_ID }) });
    const ticketId = url.searchParams.get("ticket_id");
    if (ticketId) {
      const selectedTicket = [...listTickets, ...companyTickets].find((entry) => entry.id === ticketId) || ticket();
      const scopedOrder = selectedTicket.order || { id: ORDER_ID, reference: "MST-2042", admin_url: "/admin.html?order=" + ORDER_ID + "#orders" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: detailTicket(selectedTicket), thread: { id: "thread-" + ticketId, participant: { id: USER_ID, full_name: "Avery Buyer" }, company_id: selectedTicket.company?.id || "company-1", company_name: selectedTicket.company?.name || "Acme HVAC" }, order_scope: scopedOrder, messages: [], has_more: false, next_message_cursor: null }) });
    }
    const forCompany = url.searchParams.get("company_id");
    const tickets = forCompany === "company-b" ? companyTickets : listTickets;
    if (onMessageList) onMessageList(url, tickets);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets, summary: { open: tickets.length, needs_reply: tickets.length, mine: 0, unassigned: tickets.length, waiting: 0, resolved: 0 }, has_more: false, next_cursor: null }) });
  });
}

test("desktop queue uses frozen ticket filters and ticket detail controls", async ({ page }) => {
  const urls = [];
  const details = [];
  await boot(page, { onList: (url) => urls.push(url.search), onDetail: (url) => details.push(url.search) });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(1);
  await expect(page.locator("[data-support-ticket-id]")).toContainText("Avery Buyer");
  await expect(page.locator("[data-support-ticket-id]")).toContainText("Acme HVAC");
  expect(urls.some((query) => query.includes("queue=needs_reply") && query.includes("limit=50"))).toBe(true);
  await expect(page.locator(".site-support__header")).toContainText("Support");
  await expect(page.locator("#siteSupportTitle")).toHaveText("Tickets");
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator(".site-support__ticket-head")).toContainText("MAS-000042");
  await expect(page.locator(".site-support__ticket-head")).toContainText("Damaged pail on delivery");
  await expect(page.locator(".site-support__ticket-head")).toContainText("Avery Buyer");
  await expect(page.locator(".site-support__ticket-head")).toContainText("Acme HVAC");
  await expect(page.locator(".site-support__order-scope")).toContainText("MST-2042");
  expect(await page.locator('[data-ticket-field="priority"] option').evaluateAll((options) => options.map((option) => option.value))).toEqual(["normal", "high", "urgent"]);
  expect(await page.locator('[data-ticket-field="category"] option').evaluateAll((options) => options.map((option) => option.value))).toEqual(["general", "product", "order", "shipping", "billing", "account", "technical"]);
  expect(details.some((query) => query.includes("ticket_id=" + TICKET_ID) && query.includes("order_id=" + ORDER_ID))).toBe(true);

  await page.screenshot({ path: "test-results/admin-support-ticket-queue-desktop.png", fullPage: true });

  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await expect(page.locator('[data-ticket-field="priority"]')).toHaveValue("urgent");
  await expect(page.locator(".site-support__ticket-head")).toContainText("Avery Buyer · Acme HVAC");
  await page.locator('[data-support-queue="waiting"]').click();
  expect(urls.some((query) => query.includes("queue=waiting"))).toBe(true);
});

test("company-shared ticket presents its company once in list and detail", async ({ page }) => {
  const shared = ticket({ participant: null, subject: "Company account question" });
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 1, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (url.searchParams.get("ticket_id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: detailTicket(shared), thread: { id: "thread-company", participant: null, company_id: "company-1", company_name: "Acme HVAC" }, order_scope: shared.order, messages: [], has_more: false }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [shared], summary: { open: 1, needs_reply: 1 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.locator("[data-support-ticket-id]")).toContainText("Company support · Acme HVAC");
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator(".site-support__ticket-head")).toContainText("Company support · Acme HVAC");
});

test("mobile queue becomes a full ticket detail and preserves a stale reply draft", async ({ page }) => {
  let postCount = 0;
  await boot(page, {
    post: (route) => {
      postCount += 1;
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "ticket_version_conflict" }) });
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator(".site-support__list-pane")).toBeHidden();
  await expect(page.locator("[data-support-back]")).toBeVisible();

  const reply = page.locator("#siteSupportReply");
  await reply.fill("Please send a replacement.");
  await reply.press("Control+Enter");
  await expect.poll(() => postCount).toBe(1);
  await expect(reply).toHaveValue("Please send a replacement.");
  await page.screenshot({ path: "test-results/admin-support-ticket-queue-390.png", fullPage: true });
});

test("new ticket composer sends the exact start_ticket contract and is keyboard focused", async ({ page }) => {
  const posts = [];
  await boot(page, {
    post: (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket_id: TICKET_ID, ticket: ticket() }) });
    },
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-new-ticket]").click();
  await expect(page.locator('[data-support-recipient-search]')).toBeFocused();
  await page.locator('[data-support-recipient-search]').fill("Avery");
  await page.getByRole("button", { name: /Avery Buyer/ }).click();
  await expect(page.locator(".site-support__recipient")).toContainText("Avery Buyer");
  await expect(page.locator('[name="subject"]')).toBeFocused();
  await page.locator('[name="subject"]').fill("Replacement needed");
  await page.locator('.site-support__composer [name="category"]').selectOption("shipping");
  await page.locator('[name="order_id"]').selectOption(ORDER_ID);
  await page.locator(".site-support__composer [name=\"body\"]").fill("Please arrange a replacement pail.");
  await page.getByRole("button", { name: "Start ticket" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({
    action: "start_ticket",
    recipient_user_id: USER_ID,
    subject: "Replacement needed",
    category: "shipping",
    body: "Please arrange a replacement pail.",
    order_id: ORDER_ID,
  });
  expect(posts[0].version).toBeUndefined();
});

test("Orders Message customer reaches the user-and-order composer through the real adapter", async ({ page }) => {
  await boot(page);
  await wireRealAdminEntrypoints(page, {
    orders: [{ id: ORDER_ID, order_number: "MST-2042", user_id: USER_ID, company_id: "company-1", company_name: "Acme HVAC", status: "paid", total: 100, currency: "usd", payment_method: "stripe", created_at: "2026-09-06T14:00:00Z", order_items: [] }],
    users: [{ id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test", company_id: "company-1", company_name: "Acme HVAC", role: "buyer" }],
  });
  await page.goto(BASE_URL + "/admin.html#orders");
  await page.getByRole("button", { name: "Message customer" }).click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "compose");
  await expect(page.locator("[data-support-recipient]")).toContainText("Avery Buyer");
  await expect(page.locator('[name="order_id"]')).toHaveValue(ORDER_ID);
});

test("Accounts Start chat reaches the real user messaging adapter", async ({ page }) => {
  await boot(page);
  await wireRealAdminEntrypoints(page, {
    users: [{ id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test", company_id: "company-1", company_name: "Acme HVAC", role: "buyer" }],
  });
  await page.goto(BASE_URL + "/admin.html#companies");
  await page.locator("[data-au-manage='" + USER_ID + "']").click();
  await page.locator("[data-account-user-message]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "compose");
  await expect(page.locator("[data-support-recipient]")).toContainText("Avery Buyer");
});

test("Orders company-only Message customer keeps the real order handoff scoped", async ({ page }) => {
  const companyTicket = ticket({ id: "44444444-4444-4444-8444-444444444444", display_number: "MAS-000043", company: { id: "company-b", name: "Beta Mechanical" }, subject: "Company order question" });
  const handoffs = [];
  await boot(page);
  await wireRealAdminEntrypoints(page, {
    orders: [{ id: ORDER_ID, order_number: "MST-2042", user_id: "", company_id: "company-b", company_name: "Beta Mechanical", status: "paid", total: 100, currency: "usd", payment_method: "stripe", created_at: "2026-09-06T14:00:00Z", order_items: [] }],
    companyTickets: [companyTicket],
    onMessageList: (url) => { if (url.searchParams.get("company_id") === "company-b") handoffs.push(url.search); },
  });
  await page.goto(BASE_URL + "/admin.html#orders");
  await page.getByRole("button", { name: "Message customer" }).click();
  await expect(page.locator(".site-support__ticket-head")).toContainText("Company order question");
  expect(handoffs).toHaveLength(1);
  expect(handoffs[0]).toContain("queue=all");
  expect(handoffs[0]).toContain("limit=100");
  expect(handoffs[0]).toContain("company_id=company-b");
  expect(handoffs[0]).toContain("order_id=" + ORDER_ID);
});

test("a real company-only order handoff clears A when B has no matching ticket", async ({ page }) => {
  const listRequests = [];
  await boot(page);
  await wireRealAdminEntrypoints(page, {
    orders: [{ id: ORDER_ID, order_number: "MST-2042", user_id: "", company_id: "company-b", company_name: "Beta Mechanical", status: "paid", total: 100, currency: "usd", payment_method: "stripe", created_at: "2026-09-06T14:00:00Z", order_items: [] }],
    users: [{ id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test" }],
    company: { id: "company-b", name: "Beta Mechanical" },
    companyTickets: [],
    onMessageList: (url) => listRequests.push(url.search),
  });
  await page.goto(BASE_URL + "/admin.html#orders");
  await page.locator(".site-support__launcher").click();
  await expect(page.locator("[data-support-ticket-id='" + TICKET_ID + "']")).toBeVisible();
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await expect(page.locator("#siteSupportReply")).toBeVisible();
  await page.locator("[data-support-close]").click();
  const requestCountBeforeHandoff = listRequests.length;
  await page.getByRole("button", { name: "Message customer" }).click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "compose");
  await expect(page.locator("#siteSupportReply")).toHaveCount(0);
  await expect(page.locator("[data-support-recipient-search]")).toBeVisible();
  await page.locator("[data-support-recipient-search]").fill("Avery");
  await page.getByRole("button", { name: /Avery Buyer/ }).click();
  await expect(page.locator(".site-support__recipient")).toContainText("Avery Buyer");
  await expect(page.locator('[name="order_id"]')).toHaveValue(ORDER_ID);
  const handoffRequests = listRequests.slice(requestCountBeforeHandoff);
  expect(handoffRequests).toEqual([expect.stringContaining("queue=all")]);
  expect(handoffRequests[0]).toContain("company_id=company-b");
});

test("legacy mixed-order ticket keeps account and per-message order navigation", async ({ page }) => {
  const legacyOrderId = "77777777-7777-4777-8777-777777777777";
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 1, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (url.searchParams.get("ticket_id")) return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        ticket: detailTicket({ order: null, primary_order_id: null }),
        thread: { id: "thread-legacy", participant: { id: USER_ID, full_name: "Avery Buyer" }, company_id: "company-1", company_name: "Acme HVAC" },
        order_scope: null,
        messages: [
          { id: "m-primary", sender_role: "buyer", body: "Original order question.", created_at: "2026-09-06T14:00:00Z", order: { id: ORDER_ID, reference: "MST-2042" } },
          { id: "m-legacy", sender_role: "staff", body: "Follow-up concerns a second order.", created_at: "2026-09-06T14:05:00Z", order: { id: legacyOrderId, reference: "MST-2043" } },
        ], has_more: false, next_message_cursor: null,
      }),
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket({ order: null, primary_order_id: null })], summary: { open: 1, needs_reply: 1 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.getByRole("link", { name: "View account" })).toBeVisible();
  await expect(page.locator(".site-support__order-scope")).toHaveCount(0);
  await expect(page.locator(".site-support__message-order")).toHaveCount(2);
  await page.getByRole("link", { name: "View account" }).click();
  await expect(page).toHaveURL(/#companies$/);
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await page.locator('[data-context-id="' + legacyOrderId + '"]').click();
  await expect(page).toHaveURL(/#orders$/);
});

test("settings and queue controls remain available to read-only staff", async ({ page }) => {
  await boot(page);
  await page.addInitScript(() => {});
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-settings-toggle]").click();
  await expect(page.locator("#adminNotifySupportRequests")).toBeChecked();
  await page.locator("#adminNotifyMessages").click();
  await expect(page.locator("[data-support-settings-status]")).toHaveText("Saved.");
});

test("bounded polling reads only the summary while closed and stops while hidden", async () => {
  const calls = [];
  const timers = [];
  const poller = createSupportPoller({
    isHidden: () => false,
    isOpen: () => false,
    loadSummary: async () => { calls.push("summary"); return true; },
    loadTickets: async () => { calls.push("list"); return true; },
    setTimer: (callback) => { timers.push(callback); return timers.length; },
    clearTimer: () => {},
  });
  await poller.refresh();
  expect(calls).toEqual(["summary"]);
  poller.stop();
  expect(timers.length).toBeGreaterThan(0);
});

test("resolved tickets require an explicit versioned reopen before replies return", async ({ page }) => {
  const patches = [];
  await boot(page, {
    onList: null,
  });
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PATCH") {
      patches.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ status: "open", version: 5 }) }) });
    }
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 0, needs_reply: 0 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (url.searchParams.get("ticket_id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ status: "resolved" }), messages: [], has_more: false, next_message_cursor: null, order_scope: null }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket({ status: "resolved" })], summary: { open: 0, needs_reply: 0 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.getByText("This ticket is resolved.")).toBeVisible();
  await expect(page.locator("#siteSupportReply")).toHaveCount(0);
  await page.locator('[data-ticket-field="status"]').selectOption("open");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 4, status: "open" });
});

test("cursor pagination deduplicates equal-time tickets and preserves server filter queries", async ({ page }) => {
  const calls = [];
  const secondId = "44444444-4444-4444-8444-444444444444";
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    calls.push(url.search);
    const secondPage = url.searchParams.get("cursor") === "page-2";
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        tickets: secondPage ? [ticket(), ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })] : [ticket()],
        summary: { open: 2, needs_reply: 1 }, has_more: !secondPage, next_cursor: secondPage ? null : "page-2",
      }),
    });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator('[data-support-priority]').selectOption("high");
  await expect.poll(() => calls.some((query) => query.includes("priority=high"))).toBe(true);
  await page.locator("[data-support-load-more]").click();
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(2);
  expect(calls.some((query) => query.includes("cursor=page-2"))).toBe(true);
});

test("a list failure has an in-place retry", async ({ page }) => {
  let available = false;
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 0, needs_reply: 0 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (!available) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket()], summary: { open: 1, needs_reply: 1 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(1);
});

test("read-only staff can inspect queue/detail but cannot mutate or compose", async ({ page }) => {
  await boot(page, { role: "read_only" });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.locator("[data-support-new-ticket]")).toHaveCount(0);
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator("[data-ticket-field]")).toHaveCount(0);
  await expect(page.locator("#siteSupportReply")).toHaveCount(0);
  await expect(page.locator(".site-support__notice")).toContainText("read-only");
});

test("phone settings and new-ticket composer remain reachable at 320px", async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-settings-toggle]").click();
  await expect(page.locator(".site-support__list-pane")).toBeHidden();
  await expect(page.locator("#adminNotifySupportRequests")).toBeVisible();
  await page.locator("[data-support-back]").click();
  await page.locator("[data-support-new-ticket]").click();
  await expect(page.locator('[data-support-recipient-search]')).toBeVisible();
  await expect(page.locator(".site-support__list-pane")).toBeHidden();
  await page.screenshot({ path: "test-results/admin-support-ticket-queue-320.png", fullPage: true });
});

test("queue has no horizontal overflow at tablet and desktop breakpoints", async ({ page }) => {
  await boot(page);
  for (const viewport of [{ width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto(BASE_URL + "/admin.html#support");
    const overflow = await page.locator(".site-support__drawer").evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("latest ticket detail response wins when staff switch tickets quickly", async ({ page }) => {
  const secondId = "44444444-4444-4444-8444-444444444444";
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 2 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    const requested = url.searchParams.get("ticket_id");
    if (requested === TICKET_ID) {
      await firstPending;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket(), messages: [], has_more: false }) });
    }
    if (requested === secondId) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" }), messages: [], has_more: false }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket(), ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })], summary: { open: 2, needs_reply: 2 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await page.locator("[data-support-ticket-id='" + secondId + "']").click();
  releaseFirst();
  await expect(page.locator(".site-support__ticket-head")).toContainText("Second ticket");
});

test("latest queue response wins after a rapid queue switch", async ({ page }) => {
  let releaseNeedsReply;
  const needsReplyPending = new Promise((resolve) => { releaseNeedsReply = resolve; });
  let needsReplyCalls = 0;
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (url.searchParams.get("queue") === "needs_reply" && needsReplyCalls++ === 0) {
      await needsReplyPending;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket({ subject: "Old queue result" })], has_more: false }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket({ subject: "Waiting queue result" })], has_more: false, summary: { open: 2, needs_reply: 0, waiting: 1 } }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator('[data-support-queue="waiting"]').click();
  releaseNeedsReply();
  await expect(page.locator("[data-support-ticket-id]")).toContainText("Waiting queue result");
  await expect(page.locator("[data-support-ticket-id]")).not.toContainText("Old queue result");
});

test("company-order handoff keeps staff at an explicit recipient and order choice", async ({ page }) => {
  const alternateId = "55555555-5555-4555-8555-555555555555";
  await boot(page);
  await page.unroute("**/api/admin/customers?**");
  await page.route("**/api/admin/customers?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ customers: [
      { id: USER_ID, full_name: "Avery Buyer", email: "avery@example.test", company_name: "Acme HVAC" },
      { id: alternateId, full_name: "Noah Buyer", email: "noah@example.test", company_name: "Acme HVAC" },
    ] }),
  }));
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-new-ticket]").click();
  await page.locator("[data-support-recipient-search]").fill("Acme");
  await expect(page.getByRole("button", { name: /Avery Buyer/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Noah Buyer/ })).toBeVisible();
  await page.getByRole("button", { name: /Avery Buyer/ }).click();
  await expect(page.locator(".site-support__recipient")).toContainText("Avery Buyer");
  await expect(page.locator('[name="order_id"] option')).toContainText(["General support", "MST-2042"]);
  await page.locator('[name="order_id"]').selectOption(ORDER_ID);
  await expect(page.locator('[name="order_id"]')).toHaveValue(ORDER_ID);
});

test("ticket draft survives selection changes and order context stays canonical", async ({ page }) => {
  const secondId = "44444444-4444-4444-8444-444444444444";
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 2 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    const requested = url.searchParams.get("ticket_id");
    if (requested) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ id: requested, subject: requested === secondId ? "Second ticket" : "Damaged pail on delivery" }), order_scope: { id: ORDER_ID, reference: "MST-2042", admin_url: "/admin.html?order=" + ORDER_ID + "#orders" }, messages: [], has_more: false }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket(), ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })], summary: { open: 2, needs_reply: 2 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await page.locator("#siteSupportReply").fill("Draft tied to this ticket and order.");
  await expect(page.locator(".site-support__order-scope")).toHaveAttribute("href", "/admin.html?order=" + ORDER_ID + "#orders");
  await page.locator("[data-support-ticket-id='" + secondId + "']").click();
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await expect(page.locator("#siteSupportReply")).toHaveValue("Draft tied to this ticket and order.");
});

test("a confirmed reply clears its originating draft after A to B to A", async ({ page }) => {
  const secondId = "44444444-4444-4444-8444-444444444444";
  let releaseReply;
  const pendingReply = new Promise((resolve) => { releaseReply = resolve; });
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") return pendingReply.then(() => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "m2" }) }));
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 2 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    const id = url.searchParams.get("ticket_id");
    if (id) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ id, subject: id === secondId ? "Second ticket" : "Damaged pail on delivery" }), order_scope: { id: ORDER_ID, reference: "MST-2042" }, messages: [], has_more: false }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket(), ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })], summary: { open: 2, needs_reply: 2 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await page.locator("#siteSupportReply").fill("This draft was sent.");
  const sent = page.waitForResponse((response) => response.url().includes("/api/admin/messages") && response.request().method() === "POST");
  await page.locator(".site-support__reply").getByRole("button", { name: "Send reply" }).click();
  await page.locator("[data-support-ticket-id='" + secondId + "']").click();
  await expect(page.locator(".site-support__ticket-head")).toContainText("Second ticket");
  releaseReply();
  await sent;
  await page.waitForTimeout(50);
  await page.locator("[data-support-ticket-id='" + TICKET_ID + "']").click();
  await expect(page.locator("#siteSupportReply")).toHaveValue("");
});

test("a newer edit survives a pending reply success", async ({ page }) => {
  let releaseReply;
  const pendingReply = new Promise((resolve) => { releaseReply = resolve; });
  await boot(page, { post: async (route) => { await pendingReply; return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "m2" }) }); } });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  const reply = page.locator("#siteSupportReply");
  await reply.fill("Original submitted draft.");
  await page.locator(".site-support__reply").getByRole("button", { name: "Send reply" }).click();
  await reply.fill("Newer unsent edit.");
  const sent = page.waitForResponse((response) => response.url().includes("/api/admin/messages") && response.request().method() === "POST");
  releaseReply();
  await sent;
  await page.waitForTimeout(50);
  await expect(reply).toHaveValue("Newer unsent edit.");
});

test("a delayed start_ticket completion cannot replace a newer queue context", async ({ page }) => {
  let releaseStart;
  const pendingStart = new Promise((resolve) => { releaseStart = resolve; });
  await boot(page, { post: async (route) => { await pendingStart; return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket_id: TICKET_ID, ticket: ticket() }) }); } });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-new-ticket]").click();
  await page.locator("[data-support-recipient-search]").fill("Avery");
  await page.getByRole("button", { name: /Avery Buyer/ }).click();
  await expect(page.locator(".site-support__recipient")).toContainText("Avery Buyer");
  await page.locator('[name="subject"]').fill("New ticket");
  await page.locator('.site-support__composer [name="body"]').fill("Created before navigation.");
  const started = page.waitForResponse((response) => response.url().includes("/api/admin/messages") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start ticket" }).click();
  await expect(page.locator('[name="subject"]')).toBeDisabled();
  await expect(page.locator('.site-support__composer [name="body"]')).toBeDisabled();
  await page.locator("[data-support-back]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "queue");
  releaseStart();
  await started;
  await page.waitForTimeout(100);
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "queue");
  await expect(page.locator(".site-support__ticket-head")).toHaveCount(0);
});

test("reduced motion preserves a settled, operable ticket queue", async ({ page }) => {
  await boot(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.locator("[data-support-ticket-id]")).toBeVisible();
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator("#siteSupportReply")).toBeVisible();
  const behavior = await page.locator(".site-support__messages").evaluate((node) => getComputedStyle(node).scrollBehavior);
  expect(behavior).toBe("auto");
});

test("settings back returns keyboard focus to the ticket queue", async ({ page }) => {
  await boot(page);
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-settings-toggle]").click();
  await page.locator("[data-support-back]").click();
  await expect(page.locator("[data-support-queue='needs_reply']")).toBeFocused();
});

test("reports exact ticket drawer geometry at handoff viewports", async ({ page }) => {
  await boot(page);
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const metrics = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.goto("about:blank");
    await page.goto(BASE_URL + "/admin.html#support");
    await expect(page.locator("[data-support-ticket-id]")).toHaveCount(1);
    await page.locator("[data-support-ticket-id]").click();
    await expect(page.locator("#siteSupportReply")).toBeVisible();
    metrics.push(await page.evaluate((size) => {
      const drawer = document.querySelector(".site-support__drawer");
      const reply = document.querySelector(".site-support__reply");
      const send = reply?.querySelector('[type="submit"]');
      const inside = (node) => {
        if (!node || !drawer) return false;
        const item = node.getBoundingClientRect(); const bounds = drawer.getBoundingClientRect();
        return item.top >= bounds.top && item.bottom <= bounds.bottom && item.left >= bounds.left && item.right <= bounds.right;
      };
      const box = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      return { viewport: size, document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }, detail: { drawer: box(drawer), content: box(document.querySelector("[data-support-detail]")), reply: box(reply), send: box(send), replyReachable: inside(reply), sendReachable: inside(send) } };
    }, viewport));
    await page.locator("[data-support-back]").click();
    await page.locator("[data-support-new-ticket]").click();
    await page.locator("[data-support-recipient-search]").fill("Avery");
    await expect(page.locator("[data-support-recipient-results] button")).toBeVisible();
    metrics[metrics.length - 1].compose = await page.evaluate(() => {
      const drawer = document.querySelector(".site-support__drawer");
      const recipientResult = document.querySelector("[data-support-recipient-results] button");
      const box = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const result = box(recipientResult); const bounds = box(drawer);
      return { drawer: bounds, content: box(document.querySelector("[data-support-detail]")), compose: box(document.querySelector(".site-support__composer")), recipientResult: result, recipientReachable: !!result && result.top >= bounds.top && result.bottom <= bounds.bottom && result.left >= bounds.left && result.right <= bounds.right };
    });
    await page.screenshot({ path: "test-results/admin-support-correction-" + viewport.width + ".png", fullPage: true });
  }
  metrics.forEach((measurement) => {
    expect(measurement.document.scrollWidth).toBe(measurement.document.clientWidth);
    expect(measurement.detail.replyReachable).toBe(true);
    expect(measurement.detail.sendReachable).toBe(true);
    expect(measurement.compose.recipientReachable).toBe(true);
    expect(measurement.compose.compose.bottom).toBeLessThanOrEqual(measurement.compose.drawer.bottom);
  });
});
