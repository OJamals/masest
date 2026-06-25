import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT = new URL("..", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function productsPayload() {
  const catalog = JSON.parse(read("data/catalog.seed.json"));
  const variants = new Map();
  for (const variant of catalog.product_variants || []) {
    if (!variants.has(variant.product_slug)) variants.set(variant.product_slug, []);
    variants.get(variant.product_slug).push({
      vsku: variant.sku,
      sku: variant.sku,
      label: variant.label,
      gallons: variant.size_gal,
      price: variant.retail_price,
      currency: variant.currency || "usd",
      active: variant.active !== false,
      sort: variant.sort || 0,
    });
  }
  return {
    products: (catalog.products || []).map((product) => ({
      sku: product.slug,
      slug: product.slug,
      name: product.name,
      mode: product.mode,
      active: product.active !== false,
      sort: product.sort || 0,
      image_url: product.image_url || "",
      photo_alt: product.photo_alt || product.name,
      product_variants: variants.get(product.slug) || [],
    })),
  };
}

function authModule() {
  const fixtures = {
    account: {
      email: "buyer@acmehvac.test",
      profile: { full_name: "Avery Buyer" },
      company: {
        name: "Acme HVAC and Water Systems",
        status: "approved",
        net_terms_days: 30,
        tax_exempt: true,
      },
      can_checkout: true,
      can_use_net_terms: true,
      credit: { net_outstanding: 1840, credit_available: 4160 },
      staff: { role: "admin" },
      can_admin: true,
    },
    productsPayload: productsPayload(),
    orders: [
      { id: "ord-1001", created_at: "2026-06-22T14:00:00Z", status: "net_open", total: 1840, currency: "usd", payment_method: "net", order_items: [] },
    ],
    notifications: [
      { id: "n-1", type: "message", title: "Quote follow-up", body: "Updated service packet is ready.", read: false, created_at: "2026-06-24T13:20:00Z" },
      { id: "n-2", type: "order", title: "Order awaiting NET payment", body: "Invoice is posted.", read: false, created_at: "2026-06-23T18:10:00Z" },
    ],
    messages: [
      { id: "m-1", sender_role: "buyer", body: "Can you confirm lead time?", created_at: "2026-06-24T12:10:00Z" },
      { id: "m-2", sender_role: "staff", body: "Two drums can ship Friday.", created_at: "2026-06-24T13:15:00Z" },
    ],
    addresses: [
      { id: "addr-1", type: "ship", line1: "1200 Cooling Tower Way", city: "Tampa", state: "FL", zip: "33602", is_default: true },
    ],
  };

  return `
const fixtures = ${JSON.stringify(fixtures)};
const okSession = { access_token: "stub-token", user: { id: "u-1", email: fixtures.account.email } };
export const supabase = { auth: { async getSession() { return { data: { session: okSession }, error: null }; }, async signOut() {}, async refreshSession() { return { data: { session: okSession }, error: null }; } } };
export async function me() { return fixtures.account; }
export async function logout() {}
export async function login() { return { session: okSession }; }
export async function resetPasswordForEmail() { return {}; }
export async function orders() { return fixtures.orders; }
export async function catalog() { return fixtures.productsPayload.products; }
export async function getToken() { return "stub-token"; }
export async function api(path) {
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/admin/products")) return fixtures.productsPayload;
  if (pathname.startsWith("/api/admin/stats")) return { orders: 1, revenue: 1840, pending_companies: 0, unread_messages: 1, new_quotes: 0, low_stock: 0, setup_followups: [], recent_orders: fixtures.orders };
  if (pathname.startsWith("/api/admin/inventory")) return { low_stock: [] };
  if (pathname.startsWith("/api/admin/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (pathname.startsWith("/api/admin/companies")) return { companies: [] };
  if (pathname.startsWith("/api/admin/customers")) return { customers: [] };
  if (pathname.startsWith("/api/admin/variant-pricing")) return { variants: [] };
  if (pathname.startsWith("/api/admin/coupons")) return { coupons: [] };
  if (pathname.startsWith("/api/admin/messages")) return { threads: [], messages: fixtures.messages };
  if (pathname.startsWith("/api/admin/quotes")) return { quotes: [], new_count: 0 };
  if (pathname.startsWith("/api/admin/offers")) return { offers: [] };
  if (pathname.startsWith("/api/admin/traffic")) return { totals: {}, funnel: [], campaigns: [], days: [], recent: [] };
  if (pathname.startsWith("/api/admin/qbo") || pathname.startsWith("/api/qbo")) return { connected: false };
  if (pathname === "/api/account/me") return fixtures.account;
  if (pathname.startsWith("/api/account/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (pathname.startsWith("/api/account/messages")) return { messages: fixtures.messages };
  if (pathname.startsWith("/api/account/notifications")) return { notifications: fixtures.notifications, unread: 2, total: 2, has_more: false };
  if (pathname.startsWith("/api/account/addresses")) return { addresses: fixtures.addresses };
  if (pathname.startsWith("/api/account/company")) return { company: fixtures.account.company };
  if (pathname.startsWith("/api/account/invoices")) return { invoices: [] };
  if (pathname.startsWith("/api/account/team")) return { members: [], invites: [] };
  if (pathname.startsWith("/api/account/notification-prefs")) return { notify_orders: true, notify_messages: true, notify_offers: false };
  if (pathname.startsWith("/api/account/billing-portal")) return { url: "about:blank" };
  return {};
}
`;
}

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      const ready = await fetch(`${BASE_URL}/services.html`).then((r) => r.ok).catch(() => false);
      if (ready) break;
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

async function newAuthedPage(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon";
    localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
  });
  const page = await context.newPage();
  await page.route("**/js/auth.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule() }));
  return { context, page };
}

test("admin products management keeps inline controls readable on desktop and mobile", async () => {
  await withServer(async () => {
    const browser = await chromium.launch();
    try {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const { context, page } = await newAuthedPage(browser, viewport);
        try {
          await page.goto(`${BASE_URL}/admin.html#products`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector("#admProducts [data-product]", { timeout: 10000 });
          const metrics = await page.evaluate(() => {
            const productInputs = [...document.querySelectorAll("#admProducts [data-product] [data-field='name']")]
              .map((el) => Math.round(el.getBoundingClientRect().width));
            const variantInputs = [...document.querySelectorAll("#admProducts [data-variant] [data-vfield='label'], #admProducts [data-variant] [data-vfield='price']")]
              .map((el) => Math.round(el.getBoundingClientRect().width));
            return {
              productCards: document.querySelectorAll("#admProducts [data-product]").length,
              minProductInput: Math.min(...productInputs),
              minVariantInput: Math.min(...variantInputs),
              tableCount: document.querySelectorAll("#admProducts table.adm").length,
            };
          });

          assert.ok(metrics.productCards >= 20, "all catalog products should render");
          assert.ok(metrics.minProductInput >= 140, `product name controls collapsed to ${metrics.minProductInput}px`);
          assert.ok(metrics.minVariantInput >= 90, `variant controls collapsed to ${metrics.minVariantInput}px`);
          assert.equal(metrics.tableCount, 0, "product editing should not render as one over-wide admin table");
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
});

test("services catalog stays visually connected to the next section on desktop", async () => {
  await withServer(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-service-sku]", { timeout: 10000 });
      const gap = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".service-panel:not([hidden]) .service-card")];
        const lastCard = cards.at(-1);
        const next = document.querySelector(".service-positioning");
        return Math.round(next.getBoundingClientRect().top - lastCard.getBoundingClientRect().bottom);
      });

      assert.ok(gap <= 150, `service catalog leaves ${gap}px before the next section`);
    } finally {
      await browser.close();
    }
  });
});

test("mobile dashboard navigation shows all account sections without horizontal overflow", async () => {
  await withServer(async () => {
    const browser = await chromium.launch();
    try {
      for (const hash of ["overview", "business"]) {
        const { context, page } = await newAuthedPage(browser, { width: 390, height: 844 });
        try {
          await page.goto(`${BASE_URL}/dashboard.html#${hash}`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(`.dash-panel[data-panel="${hash}"]:not([hidden])`, { timeout: 10000 });
          const nav = await page.evaluate(() => {
            const rail = document.querySelector(".dash-sidebar .dash-tabs");
            const tabs = [...document.querySelectorAll(".dash-sidebar .dash-tab")];
            return {
              overflow: Math.round(rail.scrollWidth - rail.clientWidth),
              tabCount: tabs.length,
              visibleTabCount: tabs.filter((tab) => {
                const rect = tab.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= window.innerWidth;
              }).length,
            };
          });

          assert.equal(nav.tabCount, 9, "dashboard should expose all signed-in sections");
          assert.ok(nav.overflow <= 2, `dashboard tab rail still overflows by ${nav.overflow}px`);
          assert.equal(nav.visibleTabCount, 9, "all dashboard tabs should be visible at mobile width");
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
});

test("mobile admin overview SEO audit wraps without a hidden table", async () => {
  await withServer(async () => {
    const browser = await chromium.launch();
    const { context, page } = await newAuthedPage(browser, { width: 390, height: 844 });
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#admSeo .seo-audit-row", { timeout: 10000 });
      const metrics = await page.evaluate(() => {
        const cells = [...document.querySelectorAll("#admSeo .seo-audit-row, #admSeo .seo-audit-page, #admSeo .seo-audit-meta")];
        const overflow = cells
          .map((el) => Math.round(el.scrollWidth - el.clientWidth))
          .filter((value) => value > 2);
        return {
          rowCount: document.querySelectorAll("#admSeo .seo-audit-row").length,
          tableCount: document.querySelectorAll("#admSeo table.adm").length,
          maxOverflow: overflow.length ? Math.max(...overflow) : 0,
        };
      });

      assert.equal(metrics.rowCount, 6, "admin overview should render one SEO row per audited page");
      assert.equal(metrics.tableCount, 0, "mobile SEO audit should not hide columns inside an admin table");
      assert.equal(metrics.maxOverflow, 0, `SEO audit row content still overflows by ${metrics.maxOverflow}px`);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
