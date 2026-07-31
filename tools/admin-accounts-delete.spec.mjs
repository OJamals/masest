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
  await page.getByRole("button", { name: "Businesses & approvals" }).click();

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

  await businesses.click();
  await expect.poll(() => pendingCompanyRoutes.length).toBe(1);
  await users.click();
  await businesses.click();
  await expect.poll(() => pendingCompanyRoutes.length).toBe(2);

  await expect(page.locator(".company-admin-card", { hasText: COMPANY.name })).toHaveCount(1);
});
