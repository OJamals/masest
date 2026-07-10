import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// Access-control guard for the staff console. With no staff session the admin API returns
// 401, and admin.js must keep the app hidden behind the sign-in gate. The test also asserts
// the gated endpoint was actually requested, so a pass means "booted, tried, was refused"
// rather than "script failed to load".
const PORT = 4288;
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
  await Promise.race([
    exitedOnce,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

test("anonymous visitor is blocked behind the staff sign-in gate", async ({ page }) => {
  // Ensure the Supabase client constructs so admin.js boot() reaches the gated fetch
  // (no stored session => no token => 401 path). The host is stubbed below; no real network.
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ session: null, data: { session: null } }),
  }));

  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }),
  }));

  // Wait on the response so the assertion can't race the route handler: a pass means the
  // console booted, called the staff-only endpoint, and got 401 — then gated.
  const statsResponse = page.waitForResponse((r) => r.url().includes("/api/admin/stats"));
  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });
  expect((await statsResponse).status()).toBe(401);

  await expect(page.locator("#admApp")).toBeHidden();
  await expect(page.locator("#admGate")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
});

test("staff auth stays neutral while booting and does not flash the gate between tabs", async ({ page }) => {
  let releaseStats;
  const statsBlocked = new Promise((resolve) => { releaseStats = resolve; });

  // Keep the test on the real admin controller while replacing only its auth boundary.
  // The delayed stats response creates a deterministic pending-auth window that is
  // otherwise too brief to assert reliably on a fast local machine.
  await page.route("**/js/auth.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `
      export const supabase = {};
      export async function getToken() { return "staff-token"; }
      export async function login() {}
      export async function logout() {}
      export async function api(path, options = {}) {
        const response = await fetch(path, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || "request_failed"), { status: response.status, data });
        return data;
      }
    `,
  }));
  await page.route("**/api/admin/stats", async (route) => {
    await statsBlocked;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        orders: 1,
        revenue: 0,
        companies: { pending: 0, approved: 1, suspended: 0 },
        accounts: { pending: 0, approved: 1, suspended: 0 },
        commerce: {},
        crm: {},
        catalog_health: {},
        analytics: {},
        traffic: {},
        actions: [],
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admGate")).toBeHidden();
  await expect(page.locator("#admApp")).toBeHidden();

  releaseStats();
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator("#admGate")).toBeHidden();

  await page.locator('[data-tab="orders"]').click();
  await expect(page.locator("#admGate")).toBeHidden();
  await expect(page.locator("#admApp")).toBeVisible();
});

test("staff login fields stay focusable, selectable, and password-manager compatible", async ({ page }) => {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ session: null, data: { session: null } }),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }),
  }));

  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });

  const form = page.locator("#gateForm");
  const email = page.locator("#gEmail");
  const password = page.locator("#gPass");

  await expect(form).toHaveAttribute("method", "post");
  await expect(form).toHaveAttribute("autocomplete", "on");
  await expect(email).toHaveAttribute("name", "email");
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(password).toHaveAttribute("name", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");

  for (const field of [email, password]) {
    await expect(field).toBeVisible();
    await expect(field).toBeEnabled();
    await expect(field).toBeEditable();
    const hitTarget = await field.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
    });
    expect(hitTarget).toBe(await field.getAttribute("id"));
  }

  await email.click();
  await expect(email).toBeFocused();
  await email.fill("initial@example.test");
  await email.press("ControlOrMeta+A");
  await email.type("replacement@example.test");
  await expect(email).toHaveValue("replacement@example.test");

  await password.click();
  await expect(password).toBeFocused();
  await password.fill("InitialPassword1!");
  await password.press("ControlOrMeta+A");
  await password.type("Replacement2!");
  await expect(password).toHaveValue("Replacement2!");
});
