import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect, devices } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

// Touch-device guard for the staff console. Every assertion here failed against the
// rendered console on 2026-09-13 before its fix (or was measured clean and is kept
// as a tripwire): the 44px touch floor for .btn-sm, the Integrations card clipping
// under html{overflow-x:clip}, the newsletter recipients table without a scroll
// wrapper, no scroll lock behind a modal dialog, and the nav drawer ignoring
// Escape / outside taps. Real device profiles matter: headless Chromium is
// pointer:fine at any viewport, and the touch floor is gated on pointer:coarse.
const PORT = 4343;
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

const INTEGRATION_HEALTH = {
  health: [{ provider: "stripe", completed_count: 3, pending_count: 0, dead_count: 1, last_received_at: "2026-09-01T00:00:00Z", unmatched_count: 0 }],
  effects: [{ id: "eff-1", effect_type: "webhook", status: "dead", aggregate_type: "order", aggregate_id: "ord-1", attempt_count: 3, last_error_code: "timeout" }],
  truncated: false,
};

function adminApiBody(urlStr) {
  const u = new URL(urlStr);
  const p = u.pathname;
  if (p === "/api/admin/stats") {
    return {
      commerce: {}, crm: {}, accounts: {}, catalog_health: {}, analytics: {}, content: {},
      messages: { unread: 0 }, quotes: {}, crm_tasks: {}, request_queue: [], automation: {}, traffic: {},
    };
  }
  if (p === "/api/admin/orders") return u.searchParams.get("view") === "requests" ? { requests: [] } : { orders: [], total: 0, has_more: false };
  if (p === "/api/admin/integrations") return INTEGRATION_HEALTH;
  if (p === "/api/admin/recipients") {
    return {
      counts: { subscribers: 1, imported: 1 },
      recipients: [{ email: "buyer@example.test", name: "Buyer", source: "imported", subscribed: true }],
    };
  }
  if (p === "/api/admin/newsletters") return { newsletters: [] };
  if (p === "/api/admin/stripe") return { config: { ready: true, key_mode: "test" }, webhook: {}, shipping_rates: { ready: true, count: 1 } };
  return {};
}

async function stubAdmin(page) {
  await page.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH_STUB }));
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(adminApiBody(route.request().url())),
  }));
}

const settled = (page, tab) => page.waitForFunction(
  (name) => !document.querySelector(`[data-panel="${name}"]`)?.hasAttribute("aria-busy"),
  tab,
);

async function openTab(page, tab) {
  await page.goto(`${BASE_URL}/admin.html#${tab}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await settled(page, tab);
}

// Every visible .btn-sm in the active panel, measured as rendered.
const shortButtons = (page, floor) => page.evaluate((min) => {
  const panel = document.querySelector('[data-panel][data-active="true"]');
  return [...panel.querySelectorAll(".btn-sm, .crm-tabs .btn, .pipe-toggle .btn, .saved-views .btn")]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => rect.width > 0 && rect.height > 0 && !el.closest("[hidden]"))
    .filter(({ rect }) => rect.height < min)
    .map(({ el, rect }) => `${el.id || el.className}@${Math.round(rect.height)}px`);
}, floor);

// Descendants wider than the viewport whose overflow is hidden by an ancestor's
// clip, i.e. content a finger can neither see nor scroll to.
const clippedDescendants = (page, rootSelector) => page.evaluate((selector) => {
  const root = document.querySelector(selector);
  const vw = window.innerWidth;
  const hits = [];
  for (const el of root.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.right <= vw + 1) continue;
    let node = el.parentElement;
    let scrollable = false;
    while (node && node !== document.documentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowX)) { scrollable = true; break; }
      node = node.parentElement;
    }
    if (!scrollable) hits.push(`${el.tagName.toLowerCase()}.${el.className}@${Math.round(rect.right)}`);
  }
  return hits.slice(0, 8);
}, rootSelector);

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

// Device descriptors carry defaultBrowserType (webkit for Apple profiles), which
// cannot change per describe; the touch/viewport parts are what this spec needs.
const touchProfile = (name) => { const { defaultBrowserType, ...profile } = devices[name]; return profile; };

for (const label of ["iPhone 13", "iPad Mini"]) {
  test.describe(label, () => {
    test.use(touchProfile(label));

    test("small buttons and Overview report links meet the 44px touch floor", async ({ page }) => {
      await stubAdmin(page);
      for (const tab of ["overview", "orders", "integrations", "quotes"]) {
        await openTab(page, tab);
        expect(await shortButtons(page, 44), `${tab}: .btn-sm under 44px`).toEqual([]);
      }
      const shortRoutes = await page.evaluate(() => {
        document.querySelector('[data-tab="overview"]')?.click();
        return [...document.querySelectorAll(".adm-report-card a.dash-row-route")]
          .map((el) => Math.round(el.getBoundingClientRect().height))
          .filter((h) => h > 0 && h < 44);
      });
      expect(shortRoutes, "dash-row-route links under 44px").toEqual([]);
    });

    test("the Integrations card scrolls its wide content instead of clipping it", async ({ page }) => {
      await stubAdmin(page);
      await openTab(page, "integrations");
      await expect(page.locator("#integrationDeadLetters table")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no page-level overflow").toBe(true);
      expect(await clippedDescendants(page, "#admIntegrationHealth")).toEqual([]);
    });

    test("the newsletter recipients table lives in the shared scroll wrapper", async ({ page }) => {
      await stubAdmin(page);
      await openTab(page, "newsletter");
      await page.locator('[data-nl-section="recipients"]').click();
      const table = page.locator("#nlRecipList .adm-table-wrap > table.adm");
      await expect(table).toBeVisible();
      expect(await clippedDescendants(page, "#nlRecipList")).toEqual([]);
    });

    test("a modal dialog locks the page scroll behind it", async ({ page }) => {
      await stubAdmin(page);
      await openTab(page, "orders");
      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "3000px";
        document.querySelector('[data-panel="orders"]').appendChild(spacer);
      });
      // Positive control: the page scrolls before any dialog opens.
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.id = "probeModal";
        dialog.innerHTML = "<p>probe</p>";
        document.body.appendChild(dialog);
        dialog.showModal();
      });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
      await page.evaluate(() => { document.getElementById("probeModal").close(); });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe("hidden");
    });
  });
}

test.describe("iPhone 13 drawer", () => {
  test.use(touchProfile("iPhone 13"));

  test("the nav drawer closes on Escape (focus returns to the toggle) and on an outside tap", async ({ page }) => {
    await stubAdmin(page);
    await openTab(page, "overview");
    const toggle = page.locator("#admNavToggle");
    const sidebar = page.locator(".adm-sidebar");
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(sidebar).toHaveClass(/is-open/);
    await page.locator(".adm-main").click({ position: { x: 10, y: 10 } });
    await expect(sidebar).not.toHaveClass(/is-open/);

    // Choosing a tab still closes the drawer and moves the label.
    await toggle.click();
    await page.locator('[data-tab="orders"]').click();
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(page.locator("#admNavCurrent")).toHaveText("Orders");
  });
});
