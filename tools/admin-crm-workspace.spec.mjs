import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";

const PORT = 4321;
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
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
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
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ staff_context: { email: "staff@masest.test", role: "owner" } }),
  }));
  await page.route("**/api/admin/customers**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ customers: [] }),
  }));
  await page.route("**/api/admin/crm/contacts**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ contacts: [], total: 0, has_more: false }),
  }));
}

test("an obsolete Tasks failure cannot erase the People view", async ({ page }) => {
  await bootAsStaff(page);
  let releaseTasks;
  let markTasksStarted;
  let markTasksFinished;
  const tasksGate = new Promise((resolve) => { releaseTasks = resolve; });
  const tasksStarted = new Promise((resolve) => { markTasksStarted = resolve; });
  const tasksFinished = new Promise((resolve) => { markTasksFinished = resolve; });

  await page.route("**/api/admin/crm/tasks**", async (route) => {
    markTasksStarted();
    await tasksGate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "server_error" }),
    });
    markTasksFinished();
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await tasksStarted;
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await expect(page.locator("[data-crm-ws-body] h3")).toHaveText("Everyone in one place");

  releaseTasks();
  await tasksFinished;
  await expect(page.locator("[data-crm-ws-body] h3")).toHaveText("Everyone in one place");
  await expect(page.locator("[data-crm-ws-body]")).not.toContainText("Could not load tasks");
});

test("portal users load more, search, empty, and error without a full directory fetch", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/customers**");
  const calls = [];
  const users = [
    { id: "u1", full_name: "Ada Buyer", email: "ada@example.com", role: "buyer", company_id: "c1", company_name: "Acme" },
    { id: "u2", full_name: "Ben Buyer", email: "ben@example.com", role: "buyer", company_id: "c2", company_name: "Beacon" },
    { id: "u3", full_name: "Zeta Buyer", email: "zeta@example.com", role: "buyer", company_id: "c3", company_name: "Zeta" },
  ];
  await page.route("**/api/admin/customers**", (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q") || "";
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 50);
    calls.push({ q, offset, limit });
    if (q === "Broken") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "server_error" }) });
    const matches = q === "None" ? [] : q ? users.filter((user) => user.full_name.includes(q) || user.company_name.includes(q)) : users;
    const customers = matches.slice(offset, offset + 2);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ customers, total: matches.length, has_more: offset + customers.length < matches.length }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await expect(page.locator("[data-dir-users] .crm-contact")).toHaveCount(2);
  await expect(page.locator("[data-dir-users-more]")).toContainText("2 of 3");
  expect(calls[0]).toEqual({ q: "", offset: 0, limit: 50 });

  await page.locator("[data-dir-users-more]").click();
  await expect(page.locator("[data-dir-users] .crm-contact")).toHaveCount(3);
  expect(calls.at(-1)).toEqual({ q: "", offset: 2, limit: 50 });

  const search = page.getByRole("searchbox", { name: "Search people" });
  await search.fill("Zeta");
  await page.locator("[data-dir-form]").getByRole("button", { name: "Search" }).click();
  await expect(page.locator("[data-dir-users] .crm-contact")).toHaveCount(1);
  await expect(page.locator("[data-dir-users]")).toContainText("Zeta Buyer");
  expect(calls.at(-1)).toMatchObject({ q: "Zeta", offset: 0 });

  await search.fill("None");
  await page.locator("[data-dir-form]").getByRole("button", { name: "Search" }).click();
  await expect(page.locator("[data-dir-users]")).toContainText("No portal users match that search.");

  await search.fill("Broken");
  await page.locator("[data-dir-form]").getByRole("button", { name: "Search" }).click();
  await expect(page.locator("[data-dir-users]")).toContainText("server_error");
});

test("a delayed portal-user response cannot repaint after the role facet changes", async ({ page }) => {
  await bootAsStaff(page);
  await page.unroute("**/api/admin/customers**");
  let releaseSlow;
  let markSlowStarted;
  let markSlowFinished;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const slowStarted = new Promise((resolve) => { markSlowStarted = resolve; });
  const slowFinished = new Promise((resolve) => { markSlowFinished = resolve; });

  await page.route("**/api/admin/customers**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") || "";
    if (q === "Slow") {
      markSlowStarted();
      await slowGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        customers: q === "Slow" ? [{ id: "slow", full_name: "Stale Person", role: "buyer" }] : [],
        total: q === "Slow" ? 1 : 0,
        has_more: false,
      }),
    });
    if (q === "Slow") markSlowFinished();
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  const search = page.getByRole("searchbox", { name: "Search people" });
  await search.fill("Slow");
  await page.locator("[data-dir-form]").getByRole("button", { name: "Search" }).click();
  await slowStarted;
  await page.locator("[data-dir-role]").selectOption("procurement");
  await expect(page.locator("[data-dir-users]")).toBeEmpty();

  releaseSlow();
  await slowFinished;
  await expect(page.locator("[data-dir-users]")).toBeEmpty();
  await expect(page.locator("[data-crm-ws-body]")).not.toContainText("Stale Person");
});
