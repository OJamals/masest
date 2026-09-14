import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("buyer dashboard overview has procurement action and activity mounts", () => {
  const html = read("dashboard.html");
  assert.match(html, /id="ovWorkspace"/, "overview should mount the user workspace header");
  assert.match(html, /id="ovActionRail"/, "overview should mount procurement next actions");
  assert.match(html, /id="ovRecentOrders"/, "overview should mount recent order activity");
  assert.match(html, /id="ovRecentMessages"/, "overview should mount recent message activity");
});

test("buyer dashboard renders procurement actions and recent activity", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /function renderOverviewWorkspace/, "dashboard should render the workspace readiness header");
  assert.match(js, /aria-label="Account status"/, "account header should expose accessible status markers");
  assert.match(js, /function renderBuyerActionRail/, "dashboard should render next action rail");
  assert.match(js, /function renderRecentOrders/, "dashboard should render recent orders");
  assert.match(js, /function renderRecentMessages/, "dashboard should render recent messages");
  assert.match(js, /function renderOverviewActivity/, "overview should coordinate recent activity fetches");
  assert.match(js, /\/api\/account\/messages/, "overview activity should reuse account messages API");
  assert.match(js, /fetchOrders\(\{ limit: 5, summary: true \}\)/, "overview should fetch a bounded activity page plus exact summary");
});

test("buyer dashboard action rail includes commerce and setup actions", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /Review business tools/, "pending setup should route to business hub");
  assert.match(js, /Review cart/, "approved buyers should have commerce CTA");
  assert.match(js, /Message MASEST/, "messages should remain one click away");
  assert.match(js, /data-buyer-action/, "actions should expose stable hooks for QA");
  assert.match(js, /function wirePanelLinks/, "overview CTAs should switch dashboard panels");
});

test("overview message preview does not clear unread message state", () => {
  const js = read("js/dashboard.js");
  const api = read("functions/api/account/messages.js");
  assert.match(js, /view=activity.*peek=1/, "overview should preview messages without marking them read");
  assert.match(api, /params\.get\('peek'\) !== '1'/, "messages API should expose a peek mode");
  assert.match(api, /if \(params\.get\('peek'\) !== '1'\)[\s\S]+read_by_user: true/, "normal message tab load should still mark staff messages read");
});

test("buyer messages expose ticket history and exact ticket replies", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");
  assert.match(html, /id="msgTickets"/);
  assert.match(html, /id="newTicketForm"/);
  assert.match(js, /view.*tickets/);
  assert.match(js, /ticket_cursor/);
  assert.match(js, /ticket_id/);
  assert.match(js, /message_cursor/);
  assert.match(js, /action: 'start_ticket'/);
  assert.match(js, /new URLSearchParams\(\{ ticket_id: selectedMessageTicketId, peek: '1', limit: '1' \}\)/, "live refresh should peek the selected ticket only");
  assert.doesNotMatch(js, /selectedMessageTicketId = supportTickets\[0\]/, "history must not silently select an unrelated ticket when the active GET is empty");
  assert.doesNotMatch(js, /Business setup required/);
});

test("buyer ticket selection replies with the exact ticket id and does not mark other tickets read", async () => {
  const site = await startStaticTestServer(root);
  const browser = await launchTestBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const authFixture = `
    const calls = [];
    window.__buyerApiCalls = calls;
    const tickets = [
      { id: "ticket-1", display_number: "MAS-000001", subject: "Personal issue", status: "open", scope: "personal", last_message_at: "2026-09-05T12:00:00Z" },
      { id: "ticket-2", display_number: "MAS-000002", subject: "Company issue", status: "resolved", scope: "company", last_message_at: "2026-09-04T12:00:00Z" },
    ];
    let releaseTicket2;
    const ticket2Gate = new Promise((resolve) => { releaseTicket2 = resolve; });
    let ticket2Loads = 0;
    window.__releaseTicket2 = releaseTicket2;
    window.__failTicket2 = false;
    export async function getToken() { return "fixture-token"; }
    export async function me() { return { can_admin: false, email: "buyer@example.com", profile: { full_name: "Fixture Buyer" }, company: null, setup: { steps: [] } }; }
    export async function logout() {}
    export async function updatePassword() {}
    export async function orders() { return { orders: [], total: 0, active_total: 0 }; }
    export async function api(path, options = {}) {
      calls.push({ path, options });
      if (path.includes("/api/account/messages")) {
        if (options.method === "POST") return { ticket_id: "ticket-2", ticket: tickets[1] };
        const url = new URL(path, "http://fixture");
        if (url.searchParams.get("view") === "tickets") return { tickets, has_more: false, next_ticket_cursor: null };
        if (url.searchParams.get("ticket_id") === "ticket-2") {
          ticket2Loads += 1;
          if (ticket2Loads === 1) await ticket2Gate;
          if (window.__failTicket2) throw new Error("ticket detail unavailable");
          return { ticket: tickets[1], messages: [{ id: "message-2", sender_role: "staff", body: "Resolved answer", created_at: "2026-09-04T12:00:00Z" }], has_more: false, next_message_cursor: null };
        }
        return { ticket: tickets[0], messages: [{ id: "message-1", sender_role: "buyer", body: "Personal question", created_at: "2026-09-05T12:00:00Z" }], has_more: false, next_message_cursor: null };
      }
      if (path.includes("/api/account/notifications")) return { notifications: [], unread: 0 };
      if (path.includes("/api/account/notification-prefs")) return { notify_messages: true };
      return {};
    }
  `;
  const page = await context.newPage();
  await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authFixture }));
  try {
    await page.goto(`${site.baseUrl}/dashboard.html#messages`, { waitUntil: "domcontentloaded" });
    await page.locator('#msgTickets [data-ticket-id="ticket-1"]').waitFor();
    await page.locator('#msgTickets [data-ticket-id="ticket-2"]').click();
    await page.waitForFunction(() => document.querySelector('.msg-ticket[aria-pressed="true"]')?.dataset.ticketId === "ticket-2");
    assert.equal(await page.locator("#msgTicketHeading").isHidden(), true);
    assert.equal(await page.locator("#msgForm").isHidden(), true);
    assert.doesNotMatch(await page.locator("#msgThread").textContent(), /Personal question/);
    assert.match(await page.locator("#msgThread").textContent(), /Loading issue/);
    await page.evaluate(() => window.__releaseTicket2());
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Company issue");
    const beforeReply = await page.evaluate(() => window.__buyerApiCalls.filter((call) => call.options.method === "POST"));
    assert.equal(beforeReply.length, 0, "opening a ticket must not send a read mutation");
    await page.locator("#msgInput").fill("A follow-up reply");
    await page.locator("#msgForm [type=submit]").click();
    await page.waitForFunction(() => window.__buyerApiCalls.some((call) => call.options.method === "POST" && call.options.body?.ticket_id === "ticket-2"));
    const reply = await page.evaluate(() => window.__buyerApiCalls.find((call) => call.options.method === "POST" && call.options.body?.ticket_id === "ticket-2"));
    assert.deepEqual(reply.options.body, { body: "A follow-up reply", ticket_id: "ticket-2", source: "dashboard" });
    assert.equal(Object.hasOwn(reply.options.body, "version"), false);

    await page.locator('#msgTickets [data-ticket-id="ticket-1"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Personal issue");
    await page.evaluate(() => { window.__failTicket2 = true; });
    await page.locator('#msgTickets [data-ticket-id="ticket-2"]').click();
    await page.waitForFunction(() => /Could not load this issue/.test(document.querySelector("#msgThread")?.textContent || ""));
    assert.equal(await page.locator("#msgTicketHeading").isHidden(), true);
    assert.equal(await page.locator("#msgForm").isHidden(), true);
    assert.doesNotMatch(await page.locator("#msgThread").textContent(), /Personal question/);
  } finally {
    await context.close();
    await browser.close();
    await site.close();
  }
});

test("buyer messages preserve order scope, drafts, and the selected ticket across reordered races", async () => {
  const site = await startStaticTestServer(root);
  const browser = await launchTestBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const authFixture = `
    const calls = [];
    window.__buyerRaceCalls = calls;
    window.__buyerRaceSettled = [];
    window.__buyerRaceTrace = { history: [], pending: [] };
    const order = { id: "order-42", reference: "MST-0042", status: "shipped" };
    const ticketA = { id: "ticket-a", display_number: "MAS-000041", subject: "Order question", status: "open", scope: "personal", primary_order_id: null, last_message_at: "2026-09-05T12:00:00Z" };
    const ticketB = { id: "ticket-b", display_number: "MAS-000042", subject: "Billing question", status: "open", scope: "personal", primary_order_id: order.id, order: order, last_message_at: "2026-09-04T12:00:00Z" };
    const deferred = () => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    };
    const lateADetail = deferred();
    const aReplyBarriers = [deferred(), deferred()];
    let historyPhase = "initial";
    let ticketADetailCalls = 0;
    let ticketAReplyCalls = 0;
    window.__buyerRaceControl = {
      releaseADetail() { lateADetail.resolve(); },
      releaseAReply(index) { aReplyBarriers[index]?.resolve(); },
      setHistoryPhase(phase) { historyPhase = phase; },
    };
    export async function getToken() { return "fixture-token"; }
    export async function me() { return { can_admin: false, email: "buyer@example.com", profile: { full_name: "Fixture Buyer" }, company: null, setup: { steps: [] } }; }
    export async function logout() {}
    export async function updatePassword() {}
    export async function orders() { return { orders: [order], total: 1, active_total: 1 }; }
    export async function api(path, options = {}) {
      calls.push({ path, options });
      if (options.method === "POST") {
        if (options.body?.ticket_id === "ticket-a") {
          const replyIndex = ticketAReplyCalls;
          ticketAReplyCalls += 1;
          const barrier = aReplyBarriers[replyIndex];
          if (!barrier) throw new Error("Unexpected ticket A reply");
          window.__buyerRaceTrace.pending.push("a-reply-" + replyIndex);
          await barrier.promise;
        }
        window.__buyerRaceSettled.push(options.body?.body || "");
        return { ticket_id: options.body?.ticket_id || "ticket-a", ticket: options.body?.ticket_id === "ticket-b" ? ticketB : ticketA };
      }
      const url = new URL(path, "http://fixture");
      if (url.searchParams.get("view") === "tickets") {
        const phase = historyPhase;
        const tickets = phase === "initial" || phase === "omit-selected-a" ? [ticketB] : [ticketB, ticketA];
        window.__buyerRaceTrace.history.push({ phase, returnedTicketIds: tickets.map((ticket) => ticket.id) });
        return { tickets, has_more: false, next_ticket_cursor: null };
      }
      if (url.searchParams.get("ticket_id") === "ticket-a") {
        ticketADetailCalls += 1;
        if (ticketADetailCalls > 1) {
          window.__buyerRaceTrace.pending.push("late-a-detail");
          await lateADetail.promise;
          window.__buyerRaceSettled.push("late-a-detail");
        }
        return { ticket: ticketA, messages: [{ id: "message-a", sender_role: "staff", body: "Order answer", created_at: "2026-09-05T12:00:00Z" }], has_more: false, next_message_cursor: null, order_scope: order };
      }
      if (url.searchParams.get("ticket_id") === "ticket-b") return { ticket: ticketB, messages: [{ id: "message-b", sender_role: "staff", body: "Billing answer", created_at: "2026-09-04T12:00:00Z" }], has_more: false, next_message_cursor: null, order_scope: null };
      return { ticket: ticketA, messages: [{ id: "message-a", sender_role: "staff", body: "Order answer", created_at: "2026-09-05T12:00:00Z" }], has_more: false, next_message_cursor: null, order_scope: order };
    }
  `;
  const page = await context.newPage();
  await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authFixture }));
  try {
    await page.goto(`${site.baseUrl}/dashboard.html?order=order-42#messages`, { waitUntil: "domcontentloaded" });
    await page.locator('#msgTickets [data-ticket-id="ticket-a"]').waitFor();
    await page.locator('#msgTicketSubject').waitFor({ state: "visible" });
    assert.equal(await page.locator('#msgTicketSubject').textContent(), "Order question");
    assert.equal(await page.locator('#msgOrderLabel').textContent(), "Order MST-0042");
    const initialDefault = await page.evaluate(() => window.__buyerRaceCalls.find((call) => call.path.includes("/api/account/messages") && call.options.method !== "POST" && !new URL(call.path, location.origin).searchParams.get("view") && !new URL(call.path, location.origin).searchParams.get("ticket_id")));
    assert.equal(new URL(initialDefault.path, "http://fixture").searchParams.get("order_id"), "order-42");
    const initialHistory = await page.evaluate(() => window.__buyerRaceCalls.find((call) => new URL(call.path, location.origin).searchParams.get("view") === "tickets"));
    assert.equal(new URL(initialHistory.path, "http://fixture").searchParams.get("order_id"), "order-42");
    await page.evaluate(() => window.__buyerRaceControl.setHistoryPhase("stable"));

    await page.locator("#msgInput").fill("Draft for order question");
    await page.locator('#msgTickets [data-ticket-id="ticket-b"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Billing question");
    await page.locator("#msgInput").fill("Draft for billing question");
    await page.locator('#msgTickets [data-ticket-id="ticket-a"]').click();
    await page.locator('#msgTickets [data-ticket-id="ticket-b"]').click();
    await page.waitForFunction(() => window.__buyerRaceTrace.pending.includes("late-a-detail"));
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Billing question");
    assert.equal(await page.locator("#msgInput").inputValue(), "Draft for billing question", "a late A response must not replace B's draft");
    await page.evaluate(() => window.__buyerRaceControl.releaseADetail());
    await page.waitForFunction(() => window.__buyerRaceSettled.includes("late-a-detail"));
    assert.equal(await page.locator("#msgInput").inputValue(), "Draft for billing question", "settling A detail must leave B's draft intact");

    await page.locator('#msgTickets [data-ticket-id="ticket-a"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Order question");
    await page.locator("#msgInput").fill("Reply for order question");
    await page.locator("#msgForm [type=submit]").click();
    await page.waitForFunction(() => window.__buyerRaceTrace.pending.includes("a-reply-0"));
    await page.locator('#msgTickets [data-ticket-id="ticket-b"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Billing question");
    await page.waitForFunction(() => window.__buyerRaceCalls.some((call) => call.options.method === "POST" && call.options.body?.body === "Reply for order question"));
    assert.equal(await page.locator("#msgInput").inputValue(), "Draft for billing question", "a late successful A reply must not clear B's draft");
    await page.evaluate(() => window.__buyerRaceControl.releaseAReply(0));
    await page.waitForFunction(() => window.__buyerRaceSettled.includes("Reply for order question"));
    assert.equal(await page.locator("#msgInput").inputValue(), "Draft for billing question", "settling A's reply must leave the selected B draft intact");
    await page.locator('#msgTickets [data-ticket-id="ticket-a"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Order question");
    assert.equal(await page.locator("#msgInput").inputValue(), "", "returning to A after its successful send must not restore sent text");
    await page.locator('#msgTickets [data-ticket-id="ticket-b"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Billing question");
    assert.equal(await page.locator("#msgInput").inputValue(), "Draft for billing question", "B's draft remains isolated after A settles");

    await page.locator("#msgInput").fill("Reply for billing question  ");
    await page.evaluate(() => window.__buyerRaceControl.setHistoryPhase("after-b-send"));
    const historyBeforeBReply = await page.evaluate(() => window.__buyerRaceTrace.history.length);
    await page.locator("#msgForm [type=submit]").click();
    await page.waitForFunction(() => window.__buyerRaceCalls.some((call) => call.options.method === "POST" && call.options.body?.body === "Reply for billing question"));
    const billingReply = await page.evaluate(() => window.__buyerRaceCalls.find((call) => call.options.method === "POST" && call.options.body?.body === "Reply for billing question"));
    assert.deepEqual(billingReply.options.body, { body: "Reply for billing question", order_id: "order-42", source: "dashboard", ticket_id: "ticket-b" });
    await page.waitForFunction(() => window.__buyerRaceSettled.includes("Reply for billing question") && document.querySelector("#msgInput")?.value === "");
    await page.waitForFunction((count) => window.__buyerRaceTrace.history.length > count && window.__buyerRaceTrace.history.at(-1)?.phase === "after-b-send", historyBeforeBReply);
    const afterBHistory = await page.evaluate(() => window.__buyerRaceTrace.history.at(-1));
    assert.deepEqual(afterBHistory, { phase: "after-b-send", returnedTicketIds: ["ticket-b", "ticket-a"] });
    const displayed = await page.evaluate(() => ({
      highlighted: document.querySelector('.msg-ticket[aria-pressed="true"]')?.dataset.ticketId,
      heading: document.querySelector("#msgTicketMeta")?.textContent,
    }));
    assert.equal(displayed.highlighted, "ticket-b");
    assert.match(displayed.heading, /MAS-000042/);

    await page.locator('#msgTickets [data-ticket-id="ticket-a"]').click();
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Order question");
    await page.evaluate(() => window.__buyerRaceControl.setHistoryPhase("omit-selected-a"));
    const historyBeforeOmission = await page.evaluate(() => window.__buyerRaceTrace.history.length);
    await page.locator("#refreshMessages").click();
    await page.waitForFunction((count) => window.__buyerRaceTrace.history.length > count && window.__buyerRaceTrace.history.at(-1)?.phase === "omit-selected-a", historyBeforeOmission);
    const omittedAHistory = await page.evaluate(() => window.__buyerRaceTrace.history.at(-1));
    assert.deepEqual(omittedAHistory, { phase: "omit-selected-a", returnedTicketIds: ["ticket-b"] });
    await page.waitForFunction(() => document.querySelector("#msgTicketSubject")?.textContent === "Order question");
    assert.equal(await page.locator('.msg-ticket[aria-pressed="true"]').getAttribute("data-ticket-id"), "ticket-a", "explicit selection survives a refresh that omits it from the first page");
    const selectedARead = await page.evaluate(() => window.__buyerRaceCalls.find((call) => call.options.method !== "POST" && new URL(call.path, location.origin).searchParams.get("ticket_id") === "ticket-a"));
    assert.equal(new URL(selectedARead.path, "http://fixture").searchParams.get("order_id"), "order-42");

    await page.locator("#msgInput").fill("Reply A while pending");
    await page.evaluate(() => window.__buyerRaceControl.setHistoryPhase("after-pending-a-send"));
    const historyBeforePendingAReply = await page.evaluate(() => window.__buyerRaceTrace.history.length);
    await page.locator("#msgForm [type=submit]").click();
    await page.waitForFunction(() => window.__buyerRaceTrace.pending.includes("a-reply-1"));
    await page.locator("#msgInput").fill("Newer A edit");
    await page.evaluate(() => window.__buyerRaceControl.releaseAReply(1));
    await page.waitForFunction((count) => window.__buyerRaceSettled.includes("Reply A while pending") && window.__buyerRaceTrace.history.length > count && window.__buyerRaceTrace.history.at(-1)?.phase === "after-pending-a-send", historyBeforePendingAReply);
    assert.equal(await page.locator("#msgInput").inputValue(), "Newer A edit", "a newer A draft must survive settlement and refresh of the earlier A reply");
  } finally {
    await context.close();
    await browser.close();
    await site.close();
  }
});

test("buyer messages show an explicit empty state for companyless accounts without a matching order", async () => {
  const site = await startStaticTestServer(root);
  const browser = await launchTestBrowser();
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const authFixture = `
    const order = { id: "order-missing", reference: "MST-9999", status: "shipped" };
    export async function getToken() { return "fixture-token"; }
    export async function me() { return { can_admin: false, email: "retail@example.com", profile: { full_name: "Retail Buyer" }, company: null, setup: { steps: [] } }; }
    export async function logout() {}
    export async function updatePassword() {}
    export async function orders() { return { orders: [], total: 0, active_total: 0 }; }
    export async function api(path, options = {}) {
      if (options.method === "POST") return { ticket_id: "new-ticket", ticket: { id: "new-ticket", display_number: "MAS-000099", subject: "New issue", status: "open", scope: "personal" } };
      const url = new URL(path, "http://fixture");
      if (url.searchParams.get("view") === "tickets") return { tickets: [{ id: "unrelated", display_number: "MAS-000098", subject: "Another issue", status: "resolved", scope: "company" }], has_more: false, next_ticket_cursor: null };
      if (url.searchParams.get("ticket_id")) return { ticket: null, messages: [], has_more: false, next_message_cursor: null, order_scope: null };
      return { ticket: null, messages: [], has_more: false, next_message_cursor: null, order_scope: url.searchParams.get("order_id") ? order : null };
    }
  `;
  const page = await context.newPage();
  await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authFixture }));
  try {
    await page.goto(`${site.baseUrl}/dashboard.html?order=order-missing#messages`, { waitUntil: "domcontentloaded" });
    await page.locator("#msgThread .empty-title").waitFor();
    assert.equal(await page.locator("#msgTicketHeading").isHidden(), true);
    assert.equal(await page.locator("#msgForm").isHidden(), true);
    assert.match(await page.locator("#msgThread").textContent(), /No issue selected/);
    await page.locator("#newTicketButton").click();
    assert.equal(await page.locator("#newTicketForm").isHidden(), false);
    await page.locator("#msgOrderClear").click();
    await page.waitForFunction(() => document.querySelector("#msgOrderContext")?.hidden === true);
    assert.equal(await page.locator("#msgForm").isHidden(), true);
  } finally {
    await context.close();
    await browser.close();
    await site.close();
  }
});

test("buyer new issue settles against its chosen order and ignores stale composer completions", async () => {
  const site = await startStaticTestServer(root);
  const browser = await launchTestBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const authFixture = `
    const calls = [];
    window.__newIssueCalls = calls;
    window.__newIssueSettled = [];
    const ownedOrders = {
      A: { id: "order-42", reference: "MST-0042", status: "shipped" },
      B: { id: "order-43", reference: "MST-0043", status: "shipped" },
    };
    let newIssueNumber = 0;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    export async function getToken() { return "fixture-token"; }
    export async function me() { return { can_admin: false, email: "buyer@example.com", profile: { full_name: "Retail Buyer" }, company: null, setup: { steps: [] } }; }
    export async function logout() {}
    export async function updatePassword() {}
    export async function orders() { return { orders: Object.values(ownedOrders), total: 2, active_total: 2 }; }
    export async function api(path, options = {}) {
      calls.push({ path, options });
      if (options.method === "POST") {
        if (options.body?.action === "start_ticket") {
          await wait(180);
          newIssueNumber += 1;
          const order = options.body.order_id ? Object.values(ownedOrders).find((item) => item.id === options.body.order_id) : null;
          window.__newIssueSettled.push(options.body.subject);
          return { ticket_id: "created-" + newIssueNumber, ticket: { id: "created-" + newIssueNumber, display_number: "MAS-0000" + (90 + newIssueNumber), subject: options.body.subject, status: "open", scope: "personal", order: order || null } };
        }
        return {};
      }
      const url = new URL(path, "http://fixture");
      if (url.searchParams.get("view") === "tickets") return { tickets: [{ id: "history-1", display_number: "MAS-000089", subject: "Existing issue", status: "open", scope: "personal", primary_order_id: "order-42" }], has_more: false, next_ticket_cursor: null };
      if (url.searchParams.get("ticket_id")) return { ticket: { id: url.searchParams.get("ticket_id"), display_number: "MAS-000091", subject: "Created issue", status: "open", scope: "personal" }, messages: [], has_more: false, next_message_cursor: null, order_scope: url.searchParams.get("order_id") ? ownedOrders.B : null };
      return { ticket: null, messages: [], has_more: false, next_message_cursor: null, order_scope: url.searchParams.get("order_id") === ownedOrders.A.id ? ownedOrders.A : url.searchParams.get("order_id") === ownedOrders.B.id ? ownedOrders.B : null };
    }
  `;
  const page = await context.newPage();
  await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: authFixture }));
  try {
    await page.goto(`${site.baseUrl}/dashboard.html?order=order-42#messages`, { waitUntil: "domcontentloaded" });
    await page.locator("#dashApp").waitFor({ state: "visible" });
    await page.locator('.dash-tab[data-tab="messages"]').click();
    await page.locator("#newTicketButton").waitFor({ state: "visible" });
    await page.locator("#newTicketButton").click();
    await page.locator("#msgNewOrder").selectOption("order-43");
    await page.locator("#msgNewSubject").fill("Order 43 issue");
    await page.locator("#msgNewBody").fill("Original pending body");
    await page.locator("#newTicketForm [type=submit]").click();
    await page.locator("#msgNewBody").fill("Edited while pending");
    await page.locator('.msg-ticket[data-ticket-id="history-1"]').click();
    await page.waitForFunction(() => window.__newIssueSettled.includes("Order 43 issue"));
    assert.equal(await page.locator("#newTicketForm").isHidden(), false, "edited pending completion must not close the current composer");
    assert.equal(await page.locator("#msgNewBody").inputValue(), "Edited while pending");
    assert.equal(await page.locator("#newTicketStatus").textContent(), "", "a settled stale completion must clear its old pending status");
    assert.equal(await page.locator("#newTicketForm [type=submit]").isEnabled(), true);

    await page.locator("#cancelNewTicket").click();
    await page.locator("#newTicketButton").click();
    await page.locator("#msgNewOrder").selectOption("order-43");
    await page.locator("#msgNewSubject").fill("Order 43 final issue");
    await page.locator("#msgNewBody").fill("Final order 43 body  ");
    await page.locator("#newTicketForm [type=submit]").click();
    await page.waitForFunction(() => window.__newIssueCalls.some((call) => call.options.method === "POST" && call.options.body?.subject === "Order 43 final issue"));
    const order43Post = await page.evaluate(() => window.__newIssueCalls.find((call) => call.options.method === "POST" && call.options.body?.subject === "Order 43 final issue"));
    assert.equal(order43Post.options.body.order_id, "order-43");
    await page.waitForFunction(() => window.__newIssueSettled.includes("Order 43 final issue"));
    assert.equal(new URL(await page.evaluate(() => location.href)).searchParams.get("order"), "order-43", "created order 43 reconciles the route context");
    assert.equal(await page.locator("#newTicketForm").isHidden(), true);

    await page.locator("#newTicketButton").click();
    await page.locator("#msgNewOrder").selectOption("");
    await page.locator("#msgNewSubject").fill("General issue");
    await page.locator("#msgNewBody").fill("General support body");
    await page.locator("#newTicketForm [type=submit]").click();
    await page.waitForFunction(() => window.__newIssueCalls.some((call) => call.options.method === "POST" && call.options.body?.subject === "General issue"));
    const generalPost = await page.evaluate(() => window.__newIssueCalls.find((call) => call.options.method === "POST" && call.options.body?.subject === "General issue"));
    assert.equal(generalPost.options.body.order_id, null);
    await page.waitForFunction(() => window.__newIssueSettled.includes("General issue"));
    assert.equal(new URL(await page.evaluate(() => location.href)).searchParams.get("order"), null, "general support clears the stale order 43 route");
  } finally {
    await context.close();
    await browser.close();
    await site.close();
  }
});
