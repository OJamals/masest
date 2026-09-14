import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

// Live navigation + state guard for the staff console (admin.html / js/admin.js).
// Everything here ran green as a throwaway probe on 2026-09-13 and was then found to
// have NO browser-level coverage: hash routing and legacy aliases, the tab history
// contract (a switch pushes, a committed hash canonicalizes in place), the render-token race, the panel-height reservation, feature-load
// failure, the dirty-edit guard (the one data-loss stop on this surface), the
// cross-tab session broadcast, saved-view persistence, and the roving tablist. The
// node:test suite pins these as source regexes only.
const PORT = 4341;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

const AUTH_STUB = `
  export const supabase = {};
  export async function getToken() { return "staff-token"; }
  export async function login() {}
  export async function logout() {}
  export async function apiBlob() { return new Blob(); }
  export async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "request_failed"), { status: response.status, data });
    return data;
  }
`;

const OWNER_STAFF_CONTEXT = {
  role: "owner",
  email: "owner@example.test",
  can_write: true,
  capabilities: [
    "admin.write", "order.read", "order.write", "order.delete", "order.refund", "company.credit",
    "promotion.write", "company.view_as", "prospect.write", "prospect.delete", "product.write",
    "content.assets", "content.publish", "content.review", "content.write",
    "integration.configure", "user.manage", "user.role",
  ],
};

function statsBody() {
  return JSON.stringify({
    staff_context: OWNER_STAFF_CONTEXT,
    commerce: {}, crm: {}, accounts: {}, catalog_health: {}, analytics: {}, content: {},
    messages: { unread: 0 }, quotes: {}, crm_tasks: {}, request_queue: [], automation: {}, traffic: {},
  });
}

// Per-feature empty shapes so a panel's own render settles instead of throwing.
function adminApiBody(urlStr) {
  const u = new URL(urlStr);
  const p = u.pathname;
  const view = u.searchParams.get("view");
  if (p === "/api/admin/orders") {
    if (view === "requests") return { requests: [] };
    return { orders: [], total: 0, has_more: false };
  }
  if (p === "/api/admin/companies") return { companies: [], total: 0, has_more: false };
  if (p === "/api/admin/products") return { products: [] };
  if (p === "/api/admin/quotes") {
    if (view === "report") return { report: {} };
    if (view === "workspace") return { workspace: { items: [] } };
    if (view === "contacts") return { contacts: [], company_id: null };
    return { quotes: [], total: 0, has_more: false };
  }
  if (p === "/api/admin/reviews") return { reviews: [] };
  if (p === "/api/admin/content") return { entries: [] };
  if (p === "/api/admin/crm/tasks") return { tasks: [] };
  if (p === "/api/admin/crm/contacts") return { contacts: [], total: 0, has_more: false };
  if (p === "/api/admin/messages") return { tickets: [], items: [], total: 0, summary: {} };
  return {};
}

async function stubAdmin(page) {
  await page.route("**/js/auth.js*", (route) => route.fulfill({
    status: 200, contentType: "text/javascript", body: AUTH_STUB,
  }));
  // Catch-all FIRST: Playwright matches routes last-registered-first.
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(adminApiBody(route.request().url())),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: statsBody(),
  }));
}

const settled = (page, tab) => page.waitForFunction(
  (name) => !document.querySelector(`[data-panel="${name}"]`)?.hasAttribute("aria-busy"),
  tab,
);

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(`${BASE_URL}/admin.html`);
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

test("every tab, legacy alias, and an unknown hash land on the right panel with the sidebar and label in step", async ({ page }) => {
  await stubAdmin(page);
  const cases = [
    ["overview", "overview", "Overview"],
    ["orders", "orders", "Orders"],
    ["companies", "companies", "Accounts"],
    ["products", "products", "Products"],
    ["content", "content", "Content"],
    ["quotes", "quotes", "Quotes"],
    ["crm", "crm", "People & follow-ups"],
    ["reviews", "reviews", "Reviews"],
    ["newsletter", "newsletter", "Newsletter"],
    ["analytics", "analytics", "Analytics"],
    ["finance", "finance", "Finance"],
    ["integrations", "integrations", "Integrations"],
    ["customers", "crm", "People & follow-ups"],
    ["pricing", "products", "Products"],
    ["qbo", "integrations", "Integrations"],
    ["quickbooks", "integrations", "Integrations"],
    ["bogus", "overview", "Overview"],
  ];
  for (const [hash, expectedTab, expectedLabel] of cases) {
    await page.goto(`${BASE_URL}/admin.html#${hash}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#admApp"), `#${hash}`).toBeVisible();
    await expect(page.locator(`[data-panel="${expectedTab}"]`), `#${hash} -> panel`).toHaveAttribute("data-active", "true");
    await expect(page.locator(`[data-tab="${expectedTab}"]`), `#${hash} -> tab`).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#admNavCurrent"), `#${hash} -> nav label`).toHaveText(expectedLabel);
    await expect(page, `#${hash} -> url`).toHaveURL(new RegExp(`#${expectedTab}$`));
  }
});

test("support-family hashes open the console over the current tab instead of replacing it", async ({ page }) => {
  await stubAdmin(page);
  for (const hash of ["support", "messages", "support-settings"]) {
    await page.goto(`${BASE_URL}/admin.html#${hash}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#admApp"), hash).toBeVisible();
    await expect(page.locator('[data-panel="overview"]'), `${hash} keeps overview`).toHaveAttribute("data-active", "true");
    await expect(page, `${hash} hash normalized`).toHaveURL(/#overview$/);
  }
});

test("each tab click pushes one history entry without firing hashchange, and Back/Forward step through tabs", async ({ page }) => {
  await stubAdmin(page);
  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.evaluate(() => { window.__hc = 0; window.addEventListener("hashchange", () => { window.__hc++; }); });

  const h0 = await page.evaluate(() => history.length);
  for (const tab of ["orders", "companies", "products"]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${tab}$`));
  }
  expect(await page.evaluate(() => history.length), "each switch adds exactly one entry").toBe(h0 + 3);
  expect(await page.evaluate(() => window.__hc), "clicks must not fire hashchange (double render)").toBe(0);
  await page.locator('[data-tab="products"]').click();
  expect(await page.evaluate(() => history.length), "re-clicking the open tab adds nothing").toBe(h0 + 3);

  await page.goBack();
  await expect(page).toHaveURL(/#companies$/);
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await page.goBack();
  await expect(page).toHaveURL(/#orders$/);
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await page.goForward();
  await expect(page).toHaveURL(/#companies$/);
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator('[data-tab="companies"]')).toHaveAttribute("aria-selected", "true");

  // Positive control: a typed hash still routes. An alias is canonicalized in place,
  // so Back from it returns to the previous workspace instead of bouncing forward.
  await page.evaluate(() => { location.hash = "customers"; });
  await expect(page).toHaveURL(/#crm$/);
  await expect(page.locator('[data-panel="crm"]')).toHaveAttribute("data-active", "true");
  await page.goBack();
  await expect(page).toHaveURL(/#companies$/);
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
});

test("a delayed orders render cannot win over an immediately-clicked companies tab", async ({ page }) => {
  await stubAdmin(page);
  let ordersRequests = 0;
  await page.route("**/api/admin/orders*", async (route) => {
    ordersRequests += 1;
    await new Promise((r) => setTimeout(r, 1500));
    const body = route.request().url().includes("view=requests") ? { requests: [] } : { orders: [], total: 0, has_more: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('[data-tab="orders"]').click();
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("aria-busy", "true");

  await page.locator('[data-tab="companies"]').click();
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(1800); // let the stale, delayed orders response land
  expect(ordersRequests).toBeGreaterThan(0);
  await expect(page.locator('[data-panel="orders"]'), "stale render must not reactivate its panel").toHaveAttribute("data-active", "false");
  await expect(page.locator('[data-panel="orders"]'), "aria-busy must not dangle on the inactive panel").not.toHaveAttribute("aria-busy");
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await expect.poll(() => page.locator(".adm-main").evaluate((el) => el.style.minHeight), "min-height released after settle").toBe("");
});

test("the outgoing panel's height is held across a swap and released once the short tab settles", async ({ page }) => {
  await stubAdmin(page);
  await page.route("**/api/admin/reviews*", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reviews: [] }) });
  });
  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="orders"]').click();
  await settled(page, "orders");
  await page.evaluate(() => {
    const tall = document.createElement("div");
    tall.style.height = "3000px";
    document.querySelector('[data-panel="orders"]').appendChild(tall);
  });

  await page.locator('[data-tab="reviews"]').click();
  const reservedDuring = await page.locator(".adm-main").evaluate((el) => el.style.minHeight);
  expect(parseFloat(reservedDuring), "reserved synchronously from the tall outgoing panel").toBeGreaterThan(2000);
  await expect(page.locator('[data-panel="reviews"]')).toHaveAttribute("aria-busy", "true");
  await settled(page, "reviews");
  await expect.poll(() => page.locator(".adm-main").evaluate((el) => el.style.minHeight), "a short tab must not inherit a tall tab's height").toBe("");
});

test("a failed feature module shows a tab-scoped retry banner, and Retry reloads with the hash intact", async ({ page }) => {
  await stubAdmin(page);
  let reviewsJsRequests = 0;
  await page.route("**/js/admin/reviews.js*", async (route) => {
    reviewsJsRequests += 1;
    await route.fulfill({ status: 500, contentType: "text/javascript", body: "" });
  });

  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="reviews"]').click();
  const error = page.locator('[data-panel="reviews"] [data-feature-load-error]');
  await expect(error).toContainText("Could not load Reviews");
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(reviewsJsRequests).toBe(1);

  await page.locator('[data-tab="orders"]').click();
  await expect(page.locator('[data-panel="orders"] [data-feature-load-error]'), "banner is tab-scoped").toHaveCount(0);

  await page.unroute("**/js/admin/reviews.js*");
  await page.locator('[data-tab="reviews"]').click();
  await expect(error, "the document's module map keeps the failed job until reload").toBeVisible();
  const reloaded = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await error.getByRole("button", { name: "Retry" }).click();
  await reloaded;
  await expect(page).toHaveURL(/#reviews$/);
  await expect(page.locator('[data-panel="reviews"] [data-feature-load-error]')).toHaveCount(0);
});

test("the dirty-edit guard blocks tab clicks, Back, and typed hashes, restores the URL on cancel, and clears on discard", async ({ page }) => {
  await stubAdmin(page);
  // Arrive on Orders by a click so there is a console entry behind it for Back.
  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('[data-tab="orders"]').click();
  await settled(page, "orders");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "probeDirtyInput";
    input.setAttribute("data-probe-field", "x");
    document.getElementById("admOrders").appendChild(input);
    const plain = document.createElement("input"); // negative control: nothing identifies it
    plain.id = "probePlainInput";
    document.getElementById("admOrders").appendChild(plain);
  });

  await page.locator("#probePlainInput").fill("no-id");
  await expect(page.locator("#probePlainInput")).not.toHaveAttribute("data-dirty", "1");
  await page.locator("#probeDirtyInput").fill("edited");
  await expect(page.locator("#probeDirtyInput")).toHaveAttribute("data-dirty", "1");

  const beforeunloadPrevented = () => page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(await beforeunloadPrevented(), "leaving the page is challenged while dirty").toBe(true);

  await page.locator('[data-tab="companies"]').click();
  const dialog = page.locator("dialog.confirm-dialog");
  await expect(dialog).toContainText("Discard unsaved changes and leave this workspace?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await expect(page).toHaveURL(/#orders$/);
  await expect(page.locator("#probeDirtyInput")).toHaveAttribute("data-dirty", "1");

  // Back has already moved the URL when the guard asks; Cancel walks it home by the
  // same distance without re-rendering the panel that holds the edits.
  const lengthBeforeBack = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(dialog, "the guard also fires from Back").toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page, "cancelled Back returns to the workspace").toHaveURL(/#orders$/);
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator("#probeDirtyInput"), "the kept edits survive the walk home").toHaveValue("edited");
  await expect(page.locator("#probeDirtyInput")).toHaveAttribute("data-dirty", "1");
  expect(await page.evaluate(() => history.length), "walking home adds no entry").toBe(lengthBeforeBack);

  await page.evaluate(() => { location.hash = "companies"; });
  await expect(dialog, "the guard also fires from hashchange").toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page, "hash restored on cancel").toHaveURL(/#orders$/);

  await page.locator('[data-tab="companies"]').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/#companies$/);
  await expect(page.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator("#probeDirtyInput")).not.toHaveAttribute("data-dirty", "1");
  expect(await beforeunloadPrevented(), "nothing left to guard once discarded").toBe(false);
});

test("a session that ends in one admin tab resets every sibling tab holding staff state", async ({ page, context }) => {
  await stubAdmin(page);
  const sibling = await context.newPage();
  await stubAdmin(sibling);
  await page.goto(`${BASE_URL}/admin.html#orders`, { waitUntil: "domcontentloaded" });
  await sibling.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await expect(sibling.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");

  // Negative control: an ordinary reload of one tab is not a session event.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-panel="orders"]')).toHaveAttribute("data-active", "true");
  await sibling.evaluate(() => { window.__stillHere = true; });
  await expect(sibling.locator('[data-panel="companies"]')).toHaveAttribute("data-active", "true");
  expect(await sibling.evaluate(() => window.__stillHere)).toBe(true);

  // Expiry in tab 1 must reach tab 2 through the storage channel and reload it.
  const siblingReloaded = sibling.waitForNavigation({ waitUntil: "domcontentloaded" });
  const selfReloaded = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("masest:session-expired")));
  await Promise.all([selfReloaded, siblingReloaded]);
  expect(await sibling.evaluate(() => window.__stillHere), "sibling document was replaced").toBeUndefined();
  await expect(sibling.locator("#admApp")).toBeVisible();
  await expect(sibling.locator('[data-panel="companies"]'), "reload keeps the sibling's own hash").toHaveAttribute("data-active", "true");
  await sibling.close();
});

test("saved views persist per workspace under distinct localStorage keys", async ({ page }) => {
  await stubAdmin(page);
  await page.goto(`${BASE_URL}/admin.html#orders`, { waitUntil: "domcontentloaded" });
  await settled(page, "orders");
  const savedViews = page.locator('[data-panel="orders"] .saved-views');
  await expect(savedViews).toBeVisible();
  await savedViews.locator("[data-sv-name]").fill("My Orders View");
  await savedViews.locator("[data-sv-save]").click();
  expect(await page.evaluate(() => localStorage.getItem("masest:adm:views:orders"))).toContain("My Orders View");
  expect(await page.evaluate(() => localStorage.getItem("masest:adm:views:quotes")), "no shared namespace").toBeNull();
  await page.reload({ waitUntil: "domcontentloaded" });
  await settled(page, "orders");
  await expect(page.locator('[data-panel="orders"] .saved-views [data-sv-select] option', { hasText: "My Orders View" })).toHaveCount(1);
});

test("the sidebar tablist keeps exactly one tab in the tab order and arrow/Home/End activate", async ({ page }) => {
  await stubAdmin(page);
  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  const tabs = page.locator('[role="tablist"] [role="tab"]');
  const zeroCount = async () => (await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("tabindex")))).filter((v) => v === "0").length;
  expect(await zeroCount()).toBe(1);

  await page.locator('[data-tab="overview"]').focus();
  await page.keyboard.press("ArrowDown");
  const second = await page.evaluate(() => document.activeElement?.dataset.tab);
  await expect(page.locator(`[data-tab="${second}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[data-panel="${second}"]`)).toHaveAttribute("data-active", "true");
  expect(await zeroCount()).toBe(1);
  await expect(page.locator('[data-tab="overview"]')).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("End");
  expect(await page.evaluate(() => document.activeElement?.dataset.tab)).toBe("integrations");
  await page.keyboard.press("Home");
  expect(await page.evaluate(() => document.activeElement?.dataset.tab)).toBe("overview");
  await expect(page.locator('[data-tab="overview"]')).toHaveAttribute("aria-selected", "true");
  expect(await zeroCount()).toBe(1);
});
