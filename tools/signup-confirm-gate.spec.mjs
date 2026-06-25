import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// Gating guard for B2B signup: when Supabase email-confirmation is ON, signUp returns no
// session, and account.html must NOT treat the user as logged in — it shows a "confirm your
// email" message and defers company/profile creation. The real Supabase auth endpoint is
// stubbed (no live project); the supabase-js client is loaded from its CDN as in production.
const PORT = 4196;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/account.html`).catch(() => null);
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

test("signup with email confirmation ON gates the user instead of logging in", async ({ page }) => {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  // Catch-all for any stray Supabase call (registered first => lower precedence).
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: "{}",
  }));
  // signUp success WITHOUT a session => email confirmation required.
  await page.route("**/auth/v1/signup**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "stub-user-id", aud: "authenticated", role: "authenticated",
        email: "newbuyer@example.com", confirmation_sent_at: "2026-01-01T00:00:00Z",
        app_metadata: {}, user_metadata: {},
      },
      session: null,
    }),
  }));

  await page.goto(`${BASE_URL}/account.html`, { waitUntil: "domcontentloaded" });

  // Reveal the register pane from the sign-in view. Signup collects a user account only —
  // business setup happens later from the dashboard, so there is no company field here.
  await page.locator('.acct-switch [data-pane="register"]').first().click();
  await page.locator("#rName").fill("Marisol Vega");
  await page.locator("#rEmail").fill("newbuyer@example.com");
  await page.locator("#rPass").fill("supersecret123");
  await page.locator("#rPass2").fill("supersecret123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Gated, not logged in: confirm-email message, and the signed-in dashboard never appears.
  await expect(page.locator("#rStatus")).toContainText(/confirm/i);
  await expect(page.locator("#rStatus")).toHaveAttribute("data-state", "ok");

  // The pending user profile is stashed for completion after confirmation.
  const pending = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /pending/i.test(x));
    return k ? localStorage.getItem(k) : null;
  });
  expect(pending).toContain("Marisol Vega");
});
