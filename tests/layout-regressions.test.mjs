import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const ROOT = new URL("..", import.meta.url);
let BASE_URL = "";

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
      price: Number(variant.sort || 1) * 10,
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
export async function updatePassword() { return {}; }
export async function orders() { return fixtures.orders; }
export async function catalog() { return fixtures.productsPayload.products; }
export async function getToken() { return "stub-token"; }
export async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/admin/products")) {
    if ((options.method || "GET").toUpperCase() === "DELETE") {
      const vsku = String(options.body?.vsku || "");
      const hard = Boolean(options.body?.hard);
      if (vsku) {
        for (const product of fixtures.productsPayload.products) {
          const variants = product.product_variants || [];
          const index = variants.findIndex((variant) => variant.vsku === vsku);
          if (index < 0) continue;
          if (hard) variants.splice(index, 1);
          else variants[index].active = false;
          return { ok: true, deleted: hard ? vsku : undefined, deactivated: hard ? undefined : vsku };
        }
      }
      return { ok: true };
    }
    return fixtures.productsPayload;
  }
  if (pathname.startsWith("/api/admin/stats")) return { orders: 1, revenue: 1840, pending_companies: 0, unread_messages: 1, new_quotes: 0, low_stock: 0, setup_followups: [], recent_orders: fixtures.orders };
  if (pathname.startsWith("/api/admin/inventory")) return { low_stock: [] };
  if (pathname.startsWith("/api/admin/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (pathname.startsWith("/api/admin/companies")) return { companies: [] };
  if (pathname.startsWith("/api/admin/customers")) return { customers: [] };
  if (pathname.startsWith("/api/admin/variant-pricing")) return { variants: [], services: [], programs: [] };
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
  const staticSite = await startStaticTestServer(ROOT);
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
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
  await page.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule() }));
  return { context, page };
}

test("admin products management keeps inline controls readable on desktop and mobile", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const expectedProducts = productsPayload().products.length;
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

          assert.equal(metrics.productCards, expectedProducts, "all catalog products should render");
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

test("admin products remove volume variants from the Products tab without reloading", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const { context, page } = await newAuthedPage(browser, { width: 1280, height: 900 });
    let navigations = 0;
    try {
      await page.goto(`${BASE_URL}/admin.html#products`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#admProducts [data-variant]", { timeout: 10000 });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations += 1;
      });

      const firstVariant = page.locator("#admProducts [data-variant]").first();
      const vsku = await firstVariant.getAttribute("data-variant");
      assert.ok(vsku, "expected a removable variant row");
      const beforeCount = await page.locator("#admProducts [data-variant]").count();
      await firstVariant.locator("[data-remove-variant]").click();
      await page.locator('dialog.confirm-dialog button[value="confirm"]').click();

      await page.waitForFunction((sku) => !document.querySelector(`[data-variant="${CSS.escape(sku)}"]`), vsku, { timeout: 5000 });
      const afterCount = await page.locator("#admProducts [data-variant]").count();
      assert.equal(afterCount, beforeCount - 1, "variant row should disappear after Remove is confirmed");
      assert.equal(navigations, 0, "removing a variant should not reload or navigate the admin page");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("services catalog stays visually connected to the next section on desktop", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.route("**/api/pricing", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          services: [
            { sku: "MS-PKG-INITIAL-SAMPLING-VISIT-PACKAGE", public_price: 100 },
            { sku: "MS-PKG-QUARTERLY-AUDIT", public_price: 200 },
            { sku: "MS-PKG-YEARLY-RECERTIFICATION", public_price: 300 },
            { sku: "MS-PKG-WATER-MANAGEMENT-PLAN-SETUP-ANNUAL", public_price: 400 },
          ],
        }),
      }));
      await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-service-sku]", { timeout: 10000 });
      const activePanel = page.locator(".service-panel:not([hidden])");
      const rawWaterCard = activePanel
        .locator(".service-card")
        .filter({ has: page.getByRole("heading", { name: "Raw Water - Standard Analysis", exact: true }) });
      await assert.doesNotReject(rawWaterCard.locator("p").waitFor());
      assert.match(
        await rawWaterCard.locator("p").textContent(),
        /Receive a sample\s*-\s*specific baseline water\s*-\s*analysis report/,
      );
      assert.equal(await activePanel.locator(".service-card .btn").first().textContent(), "Request water analysis");

      await page.locator('[data-service-tab="Testing - Materials"]').click();
      const materialsPanel = page.locator('[data-service-panel="Testing - Materials"]:not([hidden])');
      assert.match(
        await materialsPanel.locator(".service-category-media img").getAttribute("src"),
        /\/img\/representative\/applications\/deposit-analysis-service-v1\.webp$/,
      );
      assert.match(
        await materialsPanel.locator(".service-category-media figcaption").textContent(),
        /Representative service setup/,
      );

      await page.locator('[data-service-tab="Bid Support"]').click();
      const bidPanel = page.locator('[data-service-panel="Bid Support"]:not([hidden])');
      assert.match(
        await bidPanel.locator(".service-category-media img").getAttribute("src"),
        /\/img\/representative\/applications\/bid-wmp-review-desk-v1\.webp$/,
      );
      assert.match(
        await bidPanel.locator(".service-category-media figcaption").textContent(),
        /Representative service setup/,
      );

      await page.locator('[data-service-tab="Water Management Plan"]').click();
      const wmpPanel = page.locator('[data-service-panel="Water Management Plan"]:not([hidden])');
      assert.match(
        await wmpPanel.locator(".service-category-media img").getAttribute("src"),
        /\/img\/representative\/applications\/bid-wmp-review-desk-v1\.webp$/,
      );
      assert.match(
        await wmpPanel.locator(".service-category-media figcaption").textContent(),
        /Representative service setup/,
      );
      assert.deepEqual(
        await wmpPanel.locator(".service-card h3").allTextContents(),
        [
          "Risk Assessment (ASHRAE 188)",
          "WMP Development (ASHRAE 188)",
          "Plan Certification",
          "Monthly Dashboard Access",
          "Plan Renewal (annual)",
        ],
      );
      assert.match(
        await wmpPanel.locator(".service-card p").first().textContent(),
        /Receive a building\s*-\s*and system\s*-\s*specific risk assessment/,
      );
      assert.deepEqual(
        await wmpPanel.locator(".service-lifecycle b").allTextContents(),
        ["Assess", "Develop", "Confirm", "Monitor", "Audit", "Renew", "Recertify"],
      );
      assert.equal(await wmpPanel.locator(".service-card .btn").first().textContent(), "Request a WMP review");

      await page.locator('[data-service-tab="Service Packages"]').click();
      const packagesPanel = page.locator('[data-service-panel="Service Packages"]:not([hidden])');
      assert.deepEqual(
        await packagesPanel.locator(".service-card h3").allTextContents(),
        [
          "Initial Sampling Visit Package",
          "Quarterly Audit",
          "Yearly Recertification",
          "Water Management Plan Setup (annual)",
        ],
      );

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
    const browser = await launchTestBrowser();
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

          assert.equal(nav.tabCount, 7, "dashboard should expose all signed-in sections (7 after the profile+security / addresses+payment merges)");
          assert.ok(nav.overflow <= 2, `dashboard tab rail still overflows by ${nav.overflow}px`);
          assert.equal(nav.visibleTabCount, 7, "all dashboard tabs should be visible at mobile width");
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
});

test("dashboard sidebar scrolls independently for user and business panels", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    try {
      for (const hash of ["overview", "business"]) {
        const { context, page } = await newAuthedPage(browser, { width: 1280, height: 520 });
        try {
          await page.goto(`${BASE_URL}/dashboard.html#${hash}`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(`.dash-panel[data-panel="${hash}"]:not([hidden])`, { timeout: 10000 });
          const sidebar = page.locator(".dash-sidebar");
          await sidebar.scrollIntoViewIfNeeded();
          await page.evaluate(() => {
            const rail = document.querySelector(".dash-sidebar");
            if (rail) rail.scrollTop = 0;
          });

          const before = await page.evaluate(() => {
            const rail = document.querySelector(".dash-sidebar");
            const style = rail ? getComputedStyle(rail) : null;
            return {
              canScroll: rail ? rail.scrollHeight > rail.clientHeight : false,
              overflowY: style?.overflowY || "",
              pageY: window.scrollY,
              sidebarY: rail?.scrollTop || 0,
            };
          });
          assert.equal(before.overflowY, "auto", `${hash} dashboard sidebar should own vertical wheel scrolling`);
          assert.equal(before.canScroll, true, `${hash} dashboard sidebar should be height-bounded on short desktop viewports`);
          assert.equal(before.sidebarY, 0, `${hash} dashboard sidebar test starts at the top`);

          const box = await sidebar.boundingBox();
          assert.ok(box, `${hash} dashboard sidebar should be visible`);
          const x = box.x + Math.min(80, box.width / 2);
          const y = Math.min(Math.max(box.y + 40, 20), 500);
          await page.mouse.move(x, y);
          await page.mouse.wheel(0, 320);
          await page.waitForFunction(() => document.querySelector(".dash-sidebar")?.scrollTop > 0);

          const after = await page.evaluate(() => ({
            pageY: window.scrollY,
            sidebarY: document.querySelector(".dash-sidebar")?.scrollTop || 0,
          }));
          assert.ok(after.sidebarY > 0, `${hash} wheel over sidebar should move the sidebar scroll position`);
          assert.equal(after.pageY, before.pageY, `${hash} wheel over sidebar should not scroll dashboard content first`);

          const bottomBoundary = await page.evaluate(() => {
            const rail = document.querySelector(".dash-sidebar");
            window.scrollTo(0, 0);
            if (rail) rail.scrollTop = rail.scrollHeight;
            return { pageY: window.scrollY, sidebarY: rail?.scrollTop || 0 };
          });
          await page.evaluate(() => {
            document.querySelector(".dash-sidebar")?.dispatchEvent(new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: 320,
            }));
          });
          await page.waitForTimeout(100);
          const afterBottomBoundary = await page.evaluate(() => ({
            pageY: window.scrollY,
            sidebarY: document.querySelector(".dash-sidebar")?.scrollTop || 0,
          }));
          assert.equal(afterBottomBoundary.sidebarY, bottomBoundary.sidebarY, `${hash} sidebar should stay at its bottom boundary`);
          assert.ok(afterBottomBoundary.pageY > bottomBoundary.pageY, `${hash} wheel should continue into the page at the sidebar bottom`);

          const topBoundary = await page.evaluate(() => {
            const rail = document.querySelector(".dash-sidebar");
            const maxPageY = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, Math.min(300, maxPageY));
            if (rail) rail.scrollTop = 0;
            return { pageY: window.scrollY, sidebarY: rail?.scrollTop || 0 };
          });
          assert.ok(topBoundary.pageY > 0, `${hash} dashboard should have page space above the sidebar`);
          await page.evaluate(() => {
            document.querySelector(".dash-sidebar")?.dispatchEvent(new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: -320,
            }));
          });
          await page.waitForTimeout(100);
          const afterTopBoundary = await page.evaluate(() => ({
            pageY: window.scrollY,
            sidebarY: document.querySelector(".dash-sidebar")?.scrollTop || 0,
          }));
          assert.equal(afterTopBoundary.sidebarY, topBoundary.sidebarY, `${hash} sidebar should stay at its top boundary`);
          assert.ok(afterTopBoundary.pageY < topBoundary.pageY, `${hash} wheel should continue into the page at the sidebar top`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
});

test("mobile admin analytics SEO audit wraps without a hidden table", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const { context, page } = await newAuthedPage(browser, { width: 390, height: 844 });
    try {
      await page.goto(`${BASE_URL}/admin.html#analytics`, { waitUntil: "domcontentloaded" });
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

      assert.equal(metrics.rowCount, 6, "admin analytics should render one SEO row per audited page");
      assert.equal(metrics.tableCount, 0, "mobile SEO audit should not hide columns inside an admin table");
      assert.equal(metrics.maxOverflow, 0, `SEO audit row content still overflows by ${metrics.maxOverflow}px`);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin panels start compactly without stretched empty control rails", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const { context, page } = await newAuthedPage(browser, { width: 1440, height: 1000 });
    try {
      for (const hash of ["overview", "orders", "companies", "products", "support-settings", "quotes", "reviews", "newsletter", "crm"]) {
        await page.goto(`${BASE_URL}/admin.html#${hash}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(`.adm-panel[data-panel="${hash}"][data-active="true"]`, { timeout: 10000 });
        const metrics = await page.evaluate((panelName) => {
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const panel = document.querySelector(`.adm-panel[data-panel="${panelName}"]`);
          const sidebar = document.querySelector(".adm-sidebar");
          const shell = document.querySelector(".adm-shell");
          const subhead = document.querySelector(".adm-hero .subhead");
          const control = panel.querySelector(":scope > .crm-tabs, :scope > .adm-tools");
          const controlRect = control?.getBoundingClientRect();
          const childRects = control ? [...control.children].filter(visible).map((child) => child.getBoundingClientRect()) : [];
          const childLeft = childRects.length ? Math.min(...childRects.map((rect) => rect.left)) : 0;
          const childRight = childRects.length ? Math.max(...childRects.map((rect) => rect.right)) : 0;
          return {
            shellGap: Math.round(shell.getBoundingClientRect().top - subhead.getBoundingClientRect().bottom),
            panelTopGap: Math.round(panel.getBoundingClientRect().top - sidebar.getBoundingClientRect().top),
            controlEmptyRail: controlRect ? Math.round(controlRect.width - (childRight - childLeft)) : 0,
          };
        }, hash);

        assert.ok(metrics.shellGap <= 64, `${hash} admin shell leaves ${metrics.shellGap}px after the hero copy`);
        assert.ok(Math.abs(metrics.panelTopGap) <= 4, `${hash} panel starts ${metrics.panelTopGap}px away from the sidebar top`);
        assert.ok(metrics.controlEmptyRail <= 64, `${hash} control rail leaves ${metrics.controlEmptyRail}px of empty space`);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
