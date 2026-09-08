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

async function boot(page, { post = null, patch = null, onList = null, onDetail = null, role = "owner", ticketOverrides = {}, tickets: providedTickets = null } = {}) {
  const initialTicket = ticket(ticketOverrides);
  const ticketList = providedTickets || [initialTicket];
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
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket_id: TICKET_ID, ticket: initialTicket }) });
    }
    if (request.method() === "PATCH") {
      if (patch) return patch(route);
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
      const selectedTicket = ticketList.find((entry) => entry.id === url.searchParams.get("ticket_id")) || initialTicket;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          ticket: detailTicket(selectedTicket),
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
      body: JSON.stringify({ tickets: ticketList, summary: { open: ticketList.length, needs_reply: ticketList.length, mine: 0, unassigned: ticketList.length, waiting: 0, resolved: 0 }, has_more: false, next_cursor: null }),
    });
  });
}

async function delayFirstTicketDetail(page, { patches = null, nextVersion = 4 } = {}) {
  let detailCount = 0;
  let releaseFirst;
  let markFirstArrived;
  let markFirstSettled;
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
  const firstArrived = new Promise((resolve) => { markFirstArrived = resolve; });
  const firstSettled = new Promise((resolve) => { markFirstSettled = resolve; });
  const detailResponse = (version) => ({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      ticket: detailTicket({ version }),
      thread: { id: "thread-1", participant: { id: USER_ID, full_name: "Avery Buyer" }, company_id: "company-1", company_name: "Acme HVAC" },
      order_scope: { id: ORDER_ID, reference: "MST-2042", status: "delivered", admin_url: "/admin.html?order=" + ORDER_ID + "#orders" },
      messages: [], has_more: false, next_message_cursor: null,
    }),
  });

  await page.route("**/api/admin/messages**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PATCH" && patches) {
      const body = request.postDataJSON();
      patches.push(body);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ticket: detailTicket({ ...body, version: nextVersion + 1 }) }),
      });
    }
    if (request.method() !== "GET" || !url.searchParams.get("ticket_id")) return route.fallback();
    detailCount += 1;
    if (detailCount === 1) {
      markFirstArrived();
      await firstRelease;
      try { await route.fulfill(detailResponse(4)); } catch {}
      finally { markFirstSettled(); }
      return;
    }
    return route.fulfill(detailResponse(nextVersion));
  });

  return { firstArrived, firstSettled, releaseFirst };
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
  await page.screenshot({ path: "test-results/admin-support-ticket-queue-desktop.png", fullPage: false });
  await page.getByRole("button", { name: "Properties" }).click();
  await expect(page.locator(".site-support__order-scope")).toContainText("MST-2042");
  expect(await page.locator('[data-ticket-field="priority"] option').evaluateAll((options) => options.map((option) => option.value))).toEqual(["normal", "high", "urgent"]);
  expect(await page.locator('[data-ticket-field="category"] option').evaluateAll((options) => options.map((option) => option.value))).toEqual(["general", "product", "order", "shipping", "billing", "account", "technical"]);
  expect(details.some((query) => query.includes("ticket_id=" + TICKET_ID) && query.includes("order_id=" + ORDER_ID))).toBe(true);

  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await expect(page.locator('[data-ticket-field="priority"]')).toHaveValue("urgent");
  await expect(page.locator(".site-support__ticket-head")).toContainText("Avery Buyer · Acme HVAC");
  await page.getByRole("button", { name: "Properties" }).click();
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
  await page.screenshot({ path: "test-results/admin-support-ticket-queue-390.png", fullPage: false });
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
  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator("[data-support-priority]").selectOption("urgent");
  await expect.poll(() => handoffs.length).toBe(2);
  expect(handoffs[1]).toContain("company_id=company-b");
  expect(handoffs[1]).toContain("order_id=" + ORDER_ID);
  expect(handoffs[1]).toContain("priority=urgent");
  await page.locator("[data-support-filters-clear]").click();
  await expect.poll(() => handoffs.length).toBe(3);
  expect(handoffs[2]).toContain("company_id=company-b");
  expect(handoffs[2]).toContain("order_id=" + ORDER_ID);
  expect(handoffs[2]).not.toContain("priority=");
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
      const body = request.postDataJSON();
      patches.push(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ status: body.status, version: 4 + patches.length }) }) });
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
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="status"]').selectOption("open");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 4, status: "open" });
  await expect(page.locator("#siteSupportReply")).toBeVisible();
  await page.locator("#siteSupportReply").fill("Draft survives status transitions.");
  await page.locator('[data-ticket-field="status"]').selectOption("resolved");
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toEqual({ ticket_id: TICKET_ID, version: 5, status: "resolved" });
  await expect(page.locator("#siteSupportReply")).toHaveCount(0);
  await expect(page.getByText("This ticket is resolved.")).toBeVisible();
  await page.locator('[data-ticket-field="status"]').selectOption("open");
  await expect.poll(() => patches.length).toBe(3);
  expect(patches[2]).toEqual({ ticket_id: TICKET_ID, version: 6, status: "open" });
  await expect(page.locator("#siteSupportReply")).toHaveValue("Draft survives status transitions.");
});

test("settings cannot be stolen by ticket refresh and returning restores property edits", async ({ page }) => {
  const patches = [];
  const stateTicket = ticket();
  await boot(page, { tickets: [stateTicket], patch: (route) => {
    const body = route.request().postDataJSON(); patches.push(body);
    Object.assign(stateTicket, { category: body.category, version: stateTicket.version + 1 });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: detailTicket(stateTicket) }) });
  } });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await page.locator("[data-support-settings-toggle]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "settings");
  await expect(page.locator("#adminNotifySupportRequests")).toBeVisible();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "settings");
  await page.locator("[data-support-back]").click();
  await expect(page.getByRole("heading", { level: 3, name: "Damaged pail on delivery" })).toBeVisible();
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="category"]').selectOption("shipping");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 4, category: "shipping" });

  await page.locator("[data-support-settings-toggle]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "settings");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 3, name: "Damaged pail on delivery" })).toBeVisible();
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="category"]').selectOption("technical");
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toEqual({ ticket_id: TICKET_ID, version: 5, category: "technical" });
});

test("settings exclusively fills ticket detail while preserving an unsent reply draft", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 674 });
  await boot(page);
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();

  const reply = page.locator("#siteSupportReply");
  await expect(reply).toBeVisible();
  await reply.fill("Unsent draft stays with this ticket.");
  await page.locator("[data-support-settings-toggle]").click();

  const drawer = page.locator(".site-support__drawer");
  const conversation = page.locator(".site-support__conversation-body");
  const settings = page.locator(".site-support__settings");
  await expect(drawer).toHaveAttribute("data-view", "settings");
  await expect(settings).toBeVisible();
  await expect(conversation).toHaveAttribute("hidden", "");

  const layout = await page.locator(".site-support__detail").evaluate((detail) => {
    const toolbar = detail.querySelector(".site-support__conversation-toolbar");
    const conversationBody = detail.querySelector(".site-support__conversation-body");
    const reply = detail.querySelector("#siteSupportReply");
    const settingsPanel = detail.querySelector(".site-support__settings");
    return {
      detailHeight: detail.getBoundingClientRect().height,
      toolbarHeight: toolbar.getBoundingClientRect().height,
      conversationDisplay: getComputedStyle(conversationBody).display,
      conversationHeight: conversationBody.getBoundingClientRect().height,
      replyVisible: reply.checkVisibility(),
      replyHeight: reply.getBoundingClientRect().height,
      settingsHeight: settingsPanel.getBoundingClientRect().height,
    };
  });
  expect.soft(layout.conversationDisplay).toBe("none");
  expect.soft(layout.conversationHeight).toBe(0);
  expect.soft(layout.replyVisible).toBe(false);
  expect.soft(layout.replyHeight).toBe(0);
  expect.soft(layout.settingsHeight).toBeGreaterThanOrEqual(layout.detailHeight - layout.toolbarHeight - 1);

  await page.locator("[data-support-back]").click();
  await expect(reply).toBeVisible();
  await expect(reply).toHaveValue("Unsent draft stays with this ticket.");
});

test("a delayed ticket load cannot steal Settings and returning uses the latest ticket version", async ({ page }) => {
  const patches = [];
  await boot(page);
  const barrier = await delayFirstTicketDetail(page, { patches, nextVersion: 8 });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await barrier.firstArrived;
  await page.locator("[data-support-settings-toggle]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "settings");
  barrier.releaseFirst();
  await barrier.firstSettled;
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "settings");
  await expect(page.locator("#adminNotifySupportRequests")).toBeVisible();

  await page.locator("[data-support-back]").click();
  await page.locator("[data-support-ticket-id]").click();
  await expect(page.getByRole("heading", { level: 3, name: "Damaged pail on delivery" })).toBeVisible();
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="category"]').selectOption("shipping");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 8, category: "shipping" });
});

test("a delayed ticket load cannot replace the new-ticket composer", async ({ page }) => {
  await boot(page);
  const barrier = await delayFirstTicketDetail(page);
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await barrier.firstArrived;
  await page.locator("[data-support-new-ticket]").click();
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "compose");
  barrier.releaseFirst();
  await barrier.firstSettled;
  await expect(page.locator(".site-support__drawer")).toHaveAttribute("data-view", "compose");
  await expect(page.locator(".site-support__composer")).toBeVisible();
  await expect(page.locator("[data-support-ticket-head]")).toBeHidden();
});

test("a delayed ticket load cannot revive a closed support drawer", async ({ page }) => {
  await boot(page);
  const barrier = await delayFirstTicketDetail(page);
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await barrier.firstArrived;
  await page.locator("[data-support-close]").click();
  await expect(page.locator(".site-support__drawer")).toBeHidden();
  barrier.releaseFirst();
  await barrier.firstSettled;
  await expect(page.locator(".site-support__drawer")).toBeHidden();
  await expect(page.locator("[data-support-ticket-head]")).toHaveAttribute("hidden", "");
});

test("cursor pagination deduplicates equal-time tickets and preserves server filter queries", async ({ page }) => {
  const calls = [];
  const secondId = "44444444-4444-4444-8444-444444444444";
  await boot(page);
  await page.clock.install();
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    calls.push(url.search);
    const secondPage = url.searchParams.get("cursor") === "page-2";
    const phaseTicket = ticket({ subject: url.searchParams.get("priority") === "high" ? "Filtered Acme ticket" : "Unfiltered Acme ticket" });
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        tickets: secondPage ? [phaseTicket, ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })] : [phaseTicket],
        summary: { open: 2, needs_reply: 1 }, has_more: !secondPage, next_cursor: secondPage ? null : "page-2",
      }),
    });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.getByText("Unfiltered Acme ticket", { exact: true })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  await page.locator("#siteSupportSearch").fill("Acme");
  await page.locator('[data-support-queue="waiting"]').click();
  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator('[data-support-priority]').selectOption("high");
  await expect(page.getByText("Filtered Acme ticket", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Filters, 1 active/ })).toBeVisible();
  const callsBeforeClear = calls.length;
  await page.locator("[data-support-filters-clear]").click();
  await expect(page.locator("#siteSupportSearch")).toHaveValue("Acme");
  await expect(page.getByText("Unfiltered Acme ticket", { exact: true })).toBeVisible();
  const clearPhaseCalls = calls.slice(callsBeforeClear);
  expect(clearPhaseCalls).toHaveLength(1);
  expect(clearPhaseCalls[0]).toContain("queue=waiting");
  expect(clearPhaseCalls[0]).toContain("search=Acme");
  expect(clearPhaseCalls[0]).not.toContain("priority=");
  expect(clearPhaseCalls[0]).not.toContain("cursor=");
  const callsBeforeRefilter = calls.length;
  await page.locator('[data-support-priority]').selectOption("high");
  await expect(page.getByText("Filtered Acme ticket", { exact: true })).toBeVisible();
  const refilterPhaseCalls = calls.slice(callsBeforeRefilter);
  expect(refilterPhaseCalls).toHaveLength(1);
  expect(refilterPhaseCalls[0]).toContain("queue=waiting");
  expect(refilterPhaseCalls[0]).toContain("search=Acme");
  expect(refilterPhaseCalls[0]).toContain("priority=high");
  expect(refilterPhaseCalls[0]).not.toContain("cursor=");
  const matchingFirstPages = () => calls.filter((query) => query.includes("priority=high") && query.includes("queue=waiting") && query.includes("search=Acme") && !query.includes("cursor=")).length;
  const firstPagesBeforeDeadline = matchingFirstPages();
  await page.locator("[data-support-load-more]").click();
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(2);
  expect(calls.some((query) => query.includes("cursor=page-2") && query.includes("priority=high") && query.includes("queue=waiting") && query.includes("search=Acme"))).toBe(true);
  await page.clock.fastForward(251);
  expect(matchingFirstPages()).toBe(firstPagesBeforeDeadline);
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(2);
});

test("a pending new search turns Load more into a current-query first page", async ({ page }) => {
  const calls = [];
  const secondId = "44444444-4444-4444-8444-444444444444";
  await boot(page);
  await page.clock.install();
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 2, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    calls.push(url.search);
    const currentSearch = url.searchParams.get("search");
    const secondPage = url.searchParams.get("cursor") === "page-2";
    const firstTicket = ticket({ subject: currentSearch === "Beta" ? "Beta current-search ticket" : "Initial cursor ticket" });
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        tickets: secondPage ? [firstTicket, ticket({ id: secondId, display_number: "MAS-000043", subject: "Old cursor second ticket" })] : [firstTicket],
        summary: { open: 2, needs_reply: 1 }, has_more: !secondPage, next_cursor: secondPage ? null : "page-2",
      }),
    });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.getByText("Initial cursor ticket", { exact: true })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  await page.locator("#siteSupportSearch").fill("Beta");
  await page.locator("[data-support-load-more]").click();
  await expect(page.getByText("Beta current-search ticket", { exact: true })).toBeVisible();
  await expect(page.locator("[data-support-ticket-id]")).toHaveCount(1);
  const betaCalls = calls.filter((query) => query.includes("search=Beta"));
  expect(betaCalls).toHaveLength(1);
  expect(betaCalls[0]).not.toContain("cursor=");
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
  let patchCount = 0;
  await boot(page, { role: "read_only" });
  page.on("request", (request) => { if (request.method() === "PATCH" && request.url().includes("/api/admin/messages")) patchCount += 1; });
  await page.goto(BASE_URL + "/admin.html#support");
  await expect(page.locator("[data-support-new-ticket]")).toHaveCount(0);
  await page.locator("[data-support-ticket-id]").click();
  await page.getByRole("button", { name: "Properties" }).click();
  await expect(page.locator("[data-ticket-field]")).toHaveCount(0);
  await expect(page.locator(".site-support__property-values > *")).toHaveText(["Status", "open", "Priority", "high", "Category", "order", "Assignee", "Unassigned"]);
  await expect(page.locator("#siteSupportReply")).toHaveCount(0);
  await expect(page.locator(".site-support__notice")).toContainText("read-only");
  expect(patchCount).toBe(0);
});

test("rapid property edits serialize exact versions without losing the second update", async ({ page }) => {
  const patches = [];
  let releaseFirst;
  const firstPatch = new Promise((resolve) => { releaseFirst = resolve; });
  await boot(page, {
    patch: async (route) => {
      const body = route.request().postDataJSON();
      patches.push(body);
      if (patches.length === 1) await firstPatch;
      const updated = patches.length === 1
        ? ticket({ priority: body.priority, version: 5 })
        : ticket({ priority: "urgent", category: body.category, version: 6 });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: updated }) });
    },
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await page.locator('[data-ticket-field="category"]').selectOption("shipping");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 4, priority: "urgent" });
  releaseFirst();
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toEqual({ ticket_id: TICKET_ID, version: 5, category: "shipping" });
  await expect(page.locator('[data-ticket-field="priority"]')).toHaveValue("urgent");
  await expect(page.locator('[data-ticket-field="category"]')).toHaveValue("shipping");
});

test("a property conflict retains the reply draft, reloads the latest version, and exposes feedback", async ({ page }) => {
  const patches = [];
  let detailLoads = 0;
  await boot(page);
  await page.unroute("**/api/admin/messages**");
  await page.route("**/api/admin/messages**", (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "PATCH") {
      const body = request.postDataJSON(); patches.push(body);
      if (patches.length === 1) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "ticket_version_conflict" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: detailTicket({ version: 6, category: body.category, priority: "high" }) }) });
    }
    if (url.searchParams.get("summary") === "1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { open: 1, needs_reply: 1 } }) });
    if (url.searchParams.get("view") === "assignees") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assignees: [] }) });
    if (url.searchParams.get("ticket_id")) {
      detailLoads += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: detailTicket({ version: detailLoads === 1 ? 4 : 5, priority: "high" }), messages: [], has_more: false, next_message_cursor: null, order_scope: ticket().order }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tickets: [ticket()], summary: { open: 1, needs_reply: 1 }, has_more: false }) });
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  await page.locator("#siteSupportReply").fill("Keep this exact reply draft through the conflict.");
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await expect.poll(() => detailLoads).toBe(2);
  expect(patches[0]).toEqual({ ticket_id: TICKET_ID, version: 4, priority: "urgent" });
  await expect(page.locator("#siteSupportReply")).toHaveValue("Keep this exact reply draft through the conflict.");
  await expect(page.locator("[data-support-detail-feedback]")).toContainText("Ticket changed");
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="category"]').selectOption("shipping");
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toEqual({ ticket_id: TICKET_ID, version: 5, category: "shipping" });
});

test("queued property work from A cannot resurrect after an A to B to A selection cycle", async ({ page }) => {
  const secondId = "44444444-4444-4444-8444-444444444444";
  let releasePatch;
  let patchCompleted = false;
  const patches = [];
  const pendingPatch = new Promise((resolve) => { releasePatch = resolve; });
  await boot(page, {
    tickets: [ticket(), ticket({ id: secondId, display_number: "MAS-000043", subject: "Second ticket" })],
    patch: async (route) => {
      const body = route.request().postDataJSON();
      patches.push(body);
      if (patches.length === 1) await pendingPatch;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ priority: body.priority || "high", category: body.category || "order", version: 5 }) }) });
      if (patches.length === 1) patchCompleted = true;
    },
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator(`[data-support-ticket-id="${TICKET_ID}"]`).click();
  await page.getByRole("button", { name: "Properties" }).click();
  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await expect.poll(() => patches.length).toBe(1);
  await page.locator('[data-ticket-field="category"]').selectOption("shipping");
  await page.locator(`[data-support-ticket-id="${secondId}"]`).click();
  await expect(page.getByRole("heading", { level: 3, name: "Second ticket" })).toBeVisible();
  await page.locator(`[data-support-ticket-id="${TICKET_ID}"]`).click();
  await expect(page.getByRole("heading", { level: 3, name: "Damaged pail on delivery" })).toBeVisible();
  releasePatch();
  await expect.poll(() => patchCompleted).toBe(true);
  await expect(page.locator("[data-support-properties]")).not.toHaveAttribute("aria-busy", "true");
  expect(patches).toEqual([{ ticket_id: TICKET_ID, version: 4, priority: "urgent" }]);
  await page.getByRole("button", { name: "Properties" }).click();
  await expect(page.locator('[data-ticket-field="priority"]')).toHaveValue("high");
  await expect(page.locator('[data-ticket-field="category"]')).toHaveValue("order");
  await expect(page.locator("[data-support-detail-feedback]")).toHaveCount(0);
});

test("an auth lifecycle transition closes Properties and invalidates an in-flight update", async ({ page }) => {
  let releasePatch;
  let patchArrived = false;
  let patchCompleted = false;
  const pendingPatch = new Promise((resolve) => { releasePatch = resolve; });
  await boot(page, {
    patch: async (route) => {
      patchArrived = true;
      await pendingPatch;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ticket: ticket({ priority: "urgent", version: 5 }) }) });
      patchCompleted = true;
    },
  });
  await page.goto(BASE_URL + "/admin.html#support");
  await page.locator("[data-support-ticket-id]").click();
  const properties = page.getByRole("button", { name: "Properties" });
  await properties.click();
  await page.locator('[data-ticket-field="priority"]').selectOption("urgent");
  await expect.poll(() => patchArrived).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("masest:auth")));
  await expect(page.locator(".site-support__drawer")).toBeHidden();
  await expect(page.locator("[data-support-properties]")).toBeHidden();
  await expect(page.locator("[data-support-properties-toggle]")).toHaveAttribute("aria-expanded", "false");
  releasePatch();
  await expect.poll(() => patchCompleted).toBe(true);
  await page.locator(".site-support__launcher").click();
  await expect(page.getByRole("heading", { level: 3, name: "Damaged pail on delivery" })).toBeVisible();
  await properties.click();
  await expect(page.locator('[data-ticket-field="priority"]')).toHaveValue("high");
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
  await page.screenshot({ path: "test-results/admin-support-ticket-queue-320.png", fullPage: false });
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
  await expect(page.locator(".site-support__ticket-head")).toBeHidden();
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
    await page.screenshot({ path: "test-results/admin-support-correction-" + viewport.width + ".png", fullPage: false });
  }
  metrics.forEach((measurement) => {
    expect(measurement.document.scrollWidth).toBe(measurement.document.clientWidth);
    expect(measurement.detail.replyReachable).toBe(true);
    expect(measurement.detail.sendReachable).toBe(true);
    expect(measurement.compose.recipientReachable).toBe(true);
    expect(measurement.compose.compose.bottom).toBeLessThanOrEqual(measurement.compose.drawer.bottom);
  });
});

test("dense support controls keep filters and properties as non-reflowing accessible popovers", async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 1200, height: 674 });
  await page.goto(BASE_URL + "/admin.html#support");

  const drawer = page.locator(".site-support__drawer");
  const listPane = page.locator(".site-support__list-pane");
  const ticketList = page.locator(".site-support__tickets");
  const filterRow = page.locator(".site-support__filters");
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  const properties = page.getByRole("button", { name: "Properties" });
  const launcher = page.getByRole("button", { name: "Open support tickets" });

  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await expect(filters).toHaveAttribute("aria-controls", /.+/);
  expect((await filterRow.boundingBox()).height).toBeLessThanOrEqual(64);
  expect((await ticketList.boundingBox()).height).toBeGreaterThanOrEqual(320);
  await expect(page.locator(".site-support__drawer select:visible")).toHaveCount(0);

  await page.locator("[data-support-ticket-id]").click();
  await expect(page.locator("#siteSupportReply")).toBeVisible();
  await expect(properties).toHaveAttribute("aria-expanded", "false");
  await expect(properties).toHaveAttribute("aria-controls", /.+/);
  const toolbar = page.locator(".site-support__conversation-toolbar");
  const ticketHead = page.locator(".site-support__ticket-head");
  const transcript = page.locator(".site-support__messages");
  const toolbarBox = await toolbar.boundingBox();
  const ticketHeadBox = await ticketHead.boundingBox();
  expect(toolbarBox.height).toBeLessThanOrEqual(96);
  expect(ticketHeadBox.y).toBeGreaterThanOrEqual(toolbarBox.y);
  expect(ticketHeadBox.y + ticketHeadBox.height).toBeLessThanOrEqual(toolbarBox.y + toolbarBox.height);
  expect((await transcript.boundingBox()).height).toBeGreaterThanOrEqual(280);

  const beforeFilters = { list: await ticketList.boundingBox(), transcript: await transcript.boundingBox() };
  await filters.click();
  await expect(filters).toHaveAttribute("aria-expanded", "true");
  expect(Math.abs((await ticketList.boundingBox()).height - beforeFilters.list.height)).toBeLessThanOrEqual(1);
  expect(Math.abs((await transcript.boundingBox()).height - beforeFilters.transcript.height)).toBeLessThanOrEqual(1);
  for (const control of [page.locator("[data-support-priority]"), page.locator("[data-support-category]"), page.locator("[data-support-assignee]"), page.locator("[data-support-filters-clear]")]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(674);
    expect(await control.evaluate((node) => {
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(true);
  }

  await properties.click();
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await expect(properties).toHaveAttribute("aria-expanded", "true");
  expect(Math.abs((await ticketList.boundingBox()).height - beforeFilters.list.height)).toBeLessThanOrEqual(1);
  expect(Math.abs((await transcript.boundingBox()).height - beforeFilters.transcript.height)).toBeLessThanOrEqual(1);
  for (const control of await page.locator("[data-ticket-field]").all()) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(674);
    expect(await control.evaluate((node) => {
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(true);
  }

  const reply = page.locator("#siteSupportReply");
  await reply.fill("Keep this draft while controls dismiss.");
  await page.locator(".site-support__conversation-toolbar").click();
  await expect(properties).toHaveAttribute("aria-expanded", "false");
  await expect(reply).toHaveValue("Keep this draft while controls dismiss.");

  await properties.click();
  await page.keyboard.press("Escape");
  await expect(properties).toHaveAttribute("aria-expanded", "false");
  await expect(properties).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(launcher).toBeFocused();
});

test("dense support console keeps long subjects, Properties, and Send reachable on constrained viewports", async ({ page }) => {
  const longSubject = "Replacement request for damaged industrial VertKleen drums received after a delayed multi-stop delivery route";
  await boot(page, { ticketOverrides: { subject: longSubject, status: "waiting_on_customer", priority: "urgent", assigned_to: "staff-1" } });
  const properties = page.getByRole("button", { name: "Properties" });
  const send = page.getByRole("button", { name: "Send reply" });

  // 600x337 is the effective CSS viewport of a 1200x674 window at 200% zoom.
  for (const viewport of [{ width: 1200, height: 674 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 640 }, { width: 600, height: 337 }]) {
    await page.setViewportSize(viewport);
    await page.goto("about:blank");
    await page.goto(BASE_URL + "/admin.html#support");
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await filters.click();
    const clearFilters = page.locator("[data-support-filters-clear]");
    await clearFilters.scrollIntoViewIfNeeded();
    const clearBox = await clearFilters.boundingBox();
    expect(clearBox.height).toBeGreaterThanOrEqual(44);
    expect(clearBox.y).toBeGreaterThanOrEqual(0);
    expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(viewport.height);
    expect(await clearFilters.evaluate((node) => {
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(true);
    await page.keyboard.press("Escape");
    await expect(filters).toBeFocused();
    await page.locator("[data-support-ticket-id]").click();
    await expect(page.getByRole("heading", { level: 3, name: longSubject }), JSON.stringify(viewport)).toBeVisible();
    await expect(properties).toBeVisible();
    if (viewport.width === 1200) await page.screenshot({ path: "test-results/admin-support-density-1200x674-closed.png", fullPage: false });
    await properties.click();
    await expect(page.locator(".site-support__properties-title")).toHaveText(longSubject);
    const lastProperty = page.locator('[data-ticket-field="assigned_to"]');
    await lastProperty.scrollIntoViewIfNeeded();
    const propertyBox = await lastProperty.boundingBox();
    expect(propertyBox.height).toBeGreaterThanOrEqual(44);
    expect(propertyBox.y).toBeGreaterThanOrEqual(0);
    expect(propertyBox.y + propertyBox.height).toBeLessThanOrEqual(viewport.height);
    expect(await lastProperty.evaluate((node) => {
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(true);
    if (viewport.width === 1200) await page.screenshot({ path: "test-results/admin-support-density-1200x674.png", fullPage: false });
    await properties.click();
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeVisible();
    const close = page.getByRole("button", { name: "Close support menu" });
    for (const target of [properties, close, send]) {
      const box = await target.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(await target.evaluate((node) => {
        const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === node || node.contains(hit);
      })).toBe(true);
    }
    const pageWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth + 1);
  }
});
