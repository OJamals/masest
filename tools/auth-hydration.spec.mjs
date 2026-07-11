import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4298;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/dashboard.html`).catch(() => null);
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

async function stubRefreshableSession(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
    window.__masestTestToken = "expired-token";
    localStorage.setItem("sb-stub-auth-token", JSON.stringify({ refresh_token: "valid-refresh-token" }));
  });

  await page.route("**/vendor/supabase-js.esm.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `
      export function createClient() {
        return { auth: {
          async getSession() {
            return { data: { session: { access_token: window.__masestTestToken } }, error: null };
          },
          async refreshSession() {
            window.__masestTestToken = "fresh-token";
            return { data: { session: { access_token: "fresh-token" } }, error: null };
          },
        } };
      }
    `,
  }));

  await page.route("**/api/account/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/account/me") {
      const auth = request.headers().authorization || "";
      if (auth !== "Bearer fresh-token") {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          email: "buyer@example.test",
          profile: { id: "profile-1", full_name: "Hydrated Buyer", role: "admin" },
          company: { id: "company-1", name: "Hydrated Co" },
          can_admin: true,
          can_checkout: true,
        }),
      });
    }
    if (path === "/api/account/company") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ company: { id: "company-1", name: "Hydrated Co" } }) });
    }
    if (path === "/api/account/notifications") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread: 0, notifications: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

for (const target of ["profile", "business"]) {
  test(`refreshable session never flashes signed-out UI on ${target} dashboard`, async ({ page }) => {
    await stubRefreshableSession(page);
    await page.addInitScript(() => {
      window.__masestGuestWasVisible = false;
      document.addEventListener("DOMContentLoaded", () => {
        const deadline = performance.now() + 1500;
        const sample = () => {
          const dashboardGuest = document.querySelector("#dashGuest");
          const businessGuest = document.querySelector("#bizGuest");
          if ([dashboardGuest, businessGuest].some((element) => element && !element.hidden && getComputedStyle(element).display !== "none")) {
            window.__masestGuestWasVisible = true;
          }
          if (performance.now() < deadline) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, { once: true });
    });

    await page.goto(`${BASE_URL}/dashboard.html#${target}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashApp")).toBeVisible();
    if (target === "business") await expect(page.locator("#bizApp")).toBeVisible();
    expect(await page.evaluate(() => window.__masestGuestWasVisible)).toBe(false);
    await expect(page.locator(".nav-signin")).toHaveCount(0);
  });
}
