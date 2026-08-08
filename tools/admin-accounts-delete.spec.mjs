import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4297;
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
  await page.route("**/api/admin/stats", (route) => route.fulfill(json({})));
}

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

// #acctToggle ("Users" / "Businesses & approvals" / …) is static markup in admin.html, so
// its buttons are visible and clickable from first paint — but their delegation is attached
// by wireCompanies(), which only runs once the LAZY companies feature module loads. A click
// that lands in that window is dropped with no retry: the sub-view stays on Users, the
// business queue is never fetched, and the card never arrives. Reproduced 4/14 under
// --workers=4; the dump showed aria-pressed="false" on Businesses and only the ?limit=500
// directory request, never the ?limit=100&offset=0 queue load.
//
// data-active is set by setTab before the module is even requested, so it cannot prove the
// toggle is live. Waiting for the panel's aria-busy to clear does prove it, but deadlocks
// the stale-overlap test below, which deliberately holds its directory request in flight.
//
// The precondition that actually matters is "the click registered", and showAcctView flips
// aria-pressed synchronously — before any fetch — so that is the signal. Clicking only while
// the view is still unselected keeps this idempotent: a dropped click issues no request, so
// the request counts the stale-overlap test asserts on stay exact.
async function selectAccountView(page, name) {
  const button = page.getByRole("button", { name });
  await expect(button).toBeVisible();
  await expect(async () => {
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}
const USER = {
  id: "user-1",
  email: "buyer@example.com",
  full_name: "Buyer Example",
  role: "buyer",
  is_staff: false,
  staff_role: null,
  company_id: null,
  company_name: null,
  company_status: null,
  last_sign_in_at: null,
};
const COMPANY = {
  id: "co-1",
  name: "North Plant Services",
  status: "pending",
  price_tier: "retail",
  net_terms_days: 0,
  credit_limit: 0,
  profiles: [],
};

test("account delete failures show useful copy instead of raw JSON", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [], total: 0, has_more: false })));
  await page.route("**/api/admin/users**", (route) => {
    if (route.request().method() === "POST") return route.fulfill(json({ error: "{}" }, 500));
    return route.fulfill(json({ users: [USER] }));
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator('[data-au-row="user-1"]')).toBeVisible();

  await page.locator('[data-au-delete="user-1"]').click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.locator("#auStatus")).toHaveText("Could not delete the user. Retry.");
  await expect(page.locator('[data-au-delete="user-1"]')).toBeEnabled();
});

test("account delete success removes the user and reports completion", async ({ page }) => {
  await bootAsStaff(page);
  let deleted = false;
  let captured = null;
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [], total: 0, has_more: false })));
  await page.route("**/api/admin/users**", (route) => {
    if (route.request().method() === "POST") {
      captured = JSON.parse(route.request().postData() || "{}");
      deleted = true;
      return route.fulfill(json({ ok: true }));
    }
    return route.fulfill(json({ users: deleted ? [] : [USER] }));
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator('[data-au-row="user-1"]')).toBeVisible();

  await page.locator('[data-au-delete="user-1"]').click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect.poll(() => captured).toMatchObject({ action: "delete_user", user_id: "user-1" });
  await expect(page.locator("#auStatus")).toHaveText("User deleted.");
  await expect(page.locator('[data-au-row="user-1"]')).toHaveCount(0);
});

test("account role save persists company role and platform staff access", async ({ page }) => {
  await bootAsStaff(page);
  const calls = [];
  const user = { ...USER, company_id: "co-1", company_name: "North Plant Services", company_status: "approved" };
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));
  await page.route("**/api/admin/users**", (route) => {
    if (route.request().method() === "POST") {
      calls.push(JSON.parse(route.request().postData() || "{}"));
      return route.fulfill(json({ ok: true }));
    }
    return route.fulfill(json({ users: [user] }));
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-au-row="user-1"]')).toBeVisible();

  await page.locator('[data-au-role="user-1"]').selectOption("admin");
  await page.locator('[data-au-staff-role="user-1"]').selectOption("support");
  await page.locator('[data-au-save="user-1"]').click();

  await expect.poll(() => calls).toEqual([
    { action: "set_role", company_id: "co-1", profile_id: "user-1", role: "admin" },
    { action: "set_staff_role", user_id: "user-1", staff_role: "support" },
  ]);
  await expect(page.locator("#auStatus")).toHaveText("Roles saved.");
});

test("users table spans the account summary width while detail is closed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootAsStaff(page);
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));
  await page.route("**/api/admin/users**", (route) => route.fulfill(json({ users: [USER] })));

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-au-row="user-1"]')).toBeVisible();

  const widths = await page.locator("#admAcctUsers").evaluate((root) => {
    const metrics = root.querySelector(".account-metrics").getBoundingClientRect();
    const table = root.querySelector("[data-au-list] .adm-table-wrap").getBoundingClientRect();
    return {
      metrics: Math.round(metrics.width),
      table: Math.round(table.width),
    };
  });

  expect(Math.abs(widths.table - widths.metrics)).toBeLessThanOrEqual(2);
});

test("business approval cards expose edit and guarded delete actions with centered bulk controls", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/users**", (route) => route.fulfill(json({ users: [] })));
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await selectAccountView(page, "Businesses & approvals");

  const card = page.locator(".company-admin-card", { hasText: COMPANY.name });
  await expect(card).toBeVisible();
  await expect(card.locator('[data-business-edit="co-1"]')).toBeVisible();
  await card.locator(".crm-row-menu > summary").click();
  await expect(card.locator('[data-business-delete="co-1"]')).toBeVisible();

  const metrics = await page.locator(".company-bulk-tools").evaluate((bar) => {
    const label = bar.querySelector(".admin-select-all").getBoundingClientRect();
    const button = bar.querySelector("#bulkApprove").getBoundingClientRect();
    const labelCenter = label.top + (label.height / 2);
    const buttonCenter = button.top + (button.height / 2);
    return {
      buttonTopGap: Math.round(button.top - bar.getBoundingClientRect().top),
      buttonBottomGap: Math.round(bar.getBoundingClientRect().bottom - button.bottom),
      centerDelta: Math.abs(buttonCenter - labelCenter),
    };
  });
  expect(metrics.centerDelta).toBeLessThanOrEqual(3);
  expect(Math.abs(metrics.buttonTopGap - metrics.buttonBottomGap)).toBeLessThanOrEqual(3);
});

test("business approval queue ignores stale overlapping directory and view loads", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/users**", (route) => route.fulfill(json({ users: [] })));

  const pendingCompanyDirectories = [];
  const pendingCompanyRoutes = [];
  await page.route("**/api/admin/companies**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.searchParams.has("offset")) {
      pendingCompanyDirectories.push(route);
      return;
    }
    pendingCompanyRoutes.push(route);
    if (pendingCompanyRoutes.length !== 2) return;

    await Promise.all(pendingCompanyDirectories.map((pending) =>
      pending.fulfill(json({ companies: [COMPANY], total: 1, has_more: false }))));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await pendingCompanyRoutes[1].fulfill(json({ companies: [COMPANY], total: 1, has_more: false }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await pendingCompanyRoutes[0].fulfill(json({ companies: [COMPANY], total: 1, has_more: false }));
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  const businesses = page.getByRole("button", { name: "Businesses & approvals" });
  const users = page.getByRole("button", { name: "Users", exact: true });

  await selectAccountView(page, "Businesses & approvals");
  await expect.poll(() => pendingCompanyRoutes.length).toBe(1);
  await users.click();
  await businesses.click();
  await expect.poll(() => pendingCompanyRoutes.length).toBe(2);

  await expect(page.locator(".company-admin-card", { hasText: COMPANY.name })).toHaveCount(1);
});

// The sub-view buttons are static markup in admin.html, so staff can click them before the
// lazy companies module has loaded and bound its handler. That click used to be swallowed
// with no retry and no feedback: the view stayed on Users while the queue the buyer asked
// for was never fetched. admin.js now binds a synchronous stand-in that records the choice,
// and renderCompanies() applies state.acctView on mount.
//
// Holding the module import open is what makes this deterministic — otherwise the module
// usually wins the race and the test passes without ever entering the window it guards.
test("a sub-view clicked before the companies module loads is still honoured", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/users**", (route) => route.fulfill(json({ users: [] })));
  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));

  let moduleReleased = false;
  await page.route("**/js/admin/companies.js*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    moduleReleased = true;
    await route.fulfill({ status: 200, contentType: "text/javascript", body });
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  const businesses = page.getByRole("button", { name: "Businesses & approvals" });
  await expect(businesses).toBeVisible();

  // Click squarely inside the window: the module has not been delivered yet, so nothing is
  // listening on #acctToggle beyond admin.js's stand-in.
  expect(moduleReleased).toBe(false);
  await businesses.click();
  expect(moduleReleased).toBe(false);

  // Once the module lands the panel must come up on Businesses, not the Users default.
  await expect(businesses).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  await expect(page.locator(".company-admin-card", { hasText: COMPANY.name })).toHaveCount(1);
  await expect(page.locator('[data-acct-panel="companies"]')).toBeVisible();
});
