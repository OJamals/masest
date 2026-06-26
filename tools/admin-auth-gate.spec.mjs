import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// Access-control guard for the staff console. With no staff session the admin API returns
// 401, and admin.js must keep the app hidden behind the sign-in gate. The test also asserts
// the gated endpoint was actually requested, so a pass means "booted, tried, was refused"
// rather than "script failed to load".
const PORT = 4188;
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
