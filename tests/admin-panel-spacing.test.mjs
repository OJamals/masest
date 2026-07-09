import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4326;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const authModule = `
const okSession = { access_token: "stub-token", user: { id: "u-1", email: "staff@example.test" } };
export const supabase = { auth: { async getSession() { return { data: { session: okSession }, error: null }; }, async signOut() {}, async refreshSession() { return { data: { session: okSession }, error: null }; } } };
export async function me() { return { email: "staff@example.test", staff: { role: "admin" }, can_admin: true }; }
export async function logout() {}
export async function login() { return { session: okSession }; }
export async function resetPasswordForEmail() { return {}; }
export async function updatePassword() { return {}; }
export async function orders() { return []; }
export async function catalog() { return []; }
export async function getToken() { return "stub-token"; }
export async function api(path) {
  const pathname = new URL(path, window.location.origin).pathname;
  if (pathname.startsWith("/api/admin/stats")) return { orders: 1, revenue: 0, pending_companies: 1, unread_messages: 0, new_quotes: 0, low_stock: 0, setup_followups: [], recent_orders: [], companies: { pending: 1, approved: 2, suspended: 0 }, accounts: { pending: 1, approved: 2, suspended: 0 }, commerce: {}, crm: {}, catalog_health: {}, analytics: {}, traffic: {}, action_items: [] };
  if (pathname.startsWith("/api/admin/companies")) return { companies: [{ id: "co-1", name: "Spacing Account", status: "pending", price_tier: "retail", profiles: [] }], total: 1, has_more: false };
  if (pathname.startsWith("/api/admin/users")) return { users: [] };
  if (pathname.startsWith("/api/admin/products")) return { products: [] };
  if (pathname.startsWith("/api/admin/orders")) return { orders: [], total: 0, has_more: false };
  if (pathname.startsWith("/api/admin/quotes")) return { quotes: [], total: 0, has_more: false, new_count: 0 };
  if (pathname.startsWith("/api/admin/messages")) return { threads: [], messages: [] };
  if (pathname.startsWith("/api/admin/reviews")) return { reviews: [], total: 0, has_more: false, pending_count: 0 };
  if (pathname.startsWith("/api/admin/newsletters")) return { newsletters: [], counts: { users: 0, leads: 0, imported: 0 } };
  if (pathname.startsWith("/api/admin/recipients")) return { recipients: [], counts: { users: 0, leads: 0, imported: 0 } };
  if (pathname.startsWith("/api/admin/offers")) return { offers: [] };
  if (pathname.startsWith("/api/admin/traffic")) return { total: 0, unique: 0, events: [], funnel: [], campaigns: [], days: [], recent: [] };
  if (pathname.startsWith("/api/admin/inventory")) return { low_stock: [] };
  if (pathname.startsWith("/api/admin/variant-pricing")) return { variants: [] };
  if (pathname.startsWith("/api/admin/coupons")) return { coupons: [] };
  if (pathname.startsWith("/api/admin/qbo") || pathname.startsWith("/api/qbo")) return { connected: false, pending: 0, errored: 0, synced: 0 };
  if (pathname.startsWith("/api/admin/crm/tasks")) return { tasks: [], total: 0, has_more: false };
  if (pathname.startsWith("/api/admin/crm/contacts")) return { contacts: [], total: 0, has_more: false };
  if (pathname.startsWith("/api/admin/crm")) return { timeline: [], notes: [], tasks: [], contacts: [] };
  return {};
}
`;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: "ignore",
  });
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await fetch(`${BASE_URL}/admin.html`).then((response) => response.ok).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    if (!exited) server.kill("SIGTERM");
    await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (!exited) server.kill("SIGKILL");
  }
}

test("admin panel content starts at the sidebar top without inherited section padding", async () => {
  await withServer(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 2048, height: 768 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      for (const hash of ["orders", "companies", "products", "messages", "quotes", "reviews", "newsletter", "crm"]) {
        await page.goto(`${BASE_URL}/admin.html#${hash}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(`.adm-panel[data-panel="${hash}"][data-active="true"]`, { timeout: 10000 });
        await page.waitForTimeout(150);
        const metrics = await page.evaluate((panelName) => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const panel = document.querySelector(`.adm-panel[data-panel="${panelName}"]`);
          const sidebar = document.querySelector(".adm-sidebar");
          const candidates = [...panel.querySelectorAll(".adm-tools > *, .crm-tabs > *, .adm-card, .adm-table-wrap, .thread-layout, .adm-panel-list, .adm-grid")]
            .filter(visible);
          const first = candidates.reduce((best, element) => (
            !best || element.getBoundingClientRect().top < best.getBoundingClientRect().top ? element : best
          ), null);
          return {
            paddingTop: getComputedStyle(panel).paddingTop,
            firstGap: Math.round((first?.getBoundingClientRect().top ?? 0) - sidebar.getBoundingClientRect().top),
          };
        }, hash);

        assert.equal(metrics.paddingTop, "0px", `${hash} panel should not inherit public section padding`);
        assert.ok(metrics.firstGap <= 24, `${hash} first visible control starts ${metrics.firstGap}px below the sidebar`);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
