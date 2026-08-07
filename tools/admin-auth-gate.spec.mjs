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

async function stubStaffBoot(page) {
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
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      orders: { total: 1 },
      companies: { pending: 0, approved: 1, suspended: 0 },
      messages: { unread: 0 },
      accounts: { pending: 0, approved: 1, suspended: 0 },
      commerce: {},
      crm: {},
      catalog_health: {},
      analytics: {},
      traffic: {},
      request_queue: [],
    }),
  }));
}

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
        request_queue: [],
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

test("overview requests no lazy feature and a stale module load cannot dispatch its render", async ({ page }) => {
  await stubStaffBoot(page);
  // threads.js is deliberately absent: the support console is the one feature
  // boot mounts eagerly, because its launcher belongs on every tab rather than
  // only after staff has opened a particular one. Asserted below.
  const lazyModules = [
    "traffic.js", "seo.js", "qbo.js", "orders.js", "companies.js", "products.js",
    "pricing.js", "inventory.js", "coupons.js", "content.js", "quotes.js",
    "reviews.js", "newsletter.js", "crm-workspace.js", "offers.js", "crm.js",
  ];
  const requestedModules = [];
  let orderApiRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/js/admin/")) requestedModules.push(url.pathname.split("/").at(-1));
    if (url.pathname === "/api/admin/orders") orderApiRequests += 1;
  });

  let releaseOrdersModule;
  const ordersModuleBlocked = new Promise((resolve) => { releaseOrdersModule = resolve; });
  let markOrdersRequested;
  const ordersRequested = new Promise((resolve) => { markOrdersRequested = resolve; });
  await page.route("**/js/admin/orders.js*", async (route) => {
    markOrdersRequested();
    await ordersModuleBlocked;
    await route.continue();
  });

  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  expect(requestedModules.filter((name) => lazyModules.includes(name))).toEqual([]);
  await expect.poll(() => requestedModules.includes("threads.js")).toBe(true);

  await page.locator('[data-tab="orders"]').click();
  await ordersRequested;
  await page.locator('[data-tab="products"]').click();
  releaseOrdersModule();

  await expect(page.locator('[data-panel="products"]')).toHaveAttribute("data-active", "true");
  await expect.poll(() => requestedModules.includes("products.js")).toBe(true);
  await page.waitForTimeout(100);
  expect(orderApiRequests).toBe(0);
});

test("failed lazy import shows a retry that recovers deterministically", async ({ page }) => {
  await stubStaffBoot(page);
  let attempts = 0;
  await page.route("**/js/admin/orders.js*", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "text/javascript", body: "export {};" });
      return;
    }
    await route.continue();
  });

  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('[data-tab="orders"]').click();

  const error = page.locator('[data-panel="orders"] [data-feature-load-error]');
  await expect(error).toContainText("Could not load Orders");
  const reloaded = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await error.getByRole("button", { name: "Retry" }).click();
  await reloaded;
  await expect.poll(() => attempts).toBe(2);
  await expect(error).toHaveCount(0);
});

test("a render already in flight cannot finish after the newer workspace render", async ({ page }) => {
  await stubStaffBoot(page);
  let releaseContentRender;
  const contentRenderBlocked = new Promise((resolve) => { releaseContentRender = resolve; });
  let markContentRenderStarted;
  const contentRenderStarted = new Promise((resolve) => { markContentRenderStarted = resolve; });

  await page.route("**/js/admin/content.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `
      export function createContentTab() {
        return {
          wireContent() {},
          wireBlog() {},
          async renderContent() {
            await fetch("/api/test-content-render");
            document.body.dataset.featureRenderWinner = "content";
            document.body.dataset.contentRenderComplete = "true";
          },
          renderBlog() {},
        };
      }
    `,
  }));
  // Blog stopped being a workspace of its own — it is a sub-view of Content, and
  // its toggle re-renders in place without going through setTab. So the race has
  // to be run between two real workspaces to exercise the render token at all.
  await page.route("**/js/admin/reviews.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `
      export function createReviewsTab() {
        return {
          wireReviews() {},
          wireManualReviewForm() {},
          refreshReviewsBadge() {},
          renderReviews() {
            document.body.dataset.featureRenderWinner = "reviews";
          },
        };
      }
    `,
  }));
  await page.route("**/api/test-content-render", async (route) => {
    markContentRenderStarted();
    await contentRenderBlocked;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('[data-tab="content"]').click();
  await contentRenderStarted;
  await page.locator('[data-tab="reviews"]').click();
  releaseContentRender();

  await expect(page.locator('[data-panel="reviews"]')).toHaveAttribute("data-active", "true");
  // The stale render does finish — the point is that finishing last does not let
  // it repaint a workspace staff has already navigated away from.
  await expect.poll(() => page.locator("body").getAttribute("data-content-render-complete")).toBe("true");
  await expect(page.locator("body")).toHaveAttribute("data-feature-render-winner", "reviews");
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
