import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";

const authModule = `
const okSession = { access_token: "stub-token", user: { id: "u-1", email: "staff@example.test" } };
export const supabase = { auth: { async getSession() { return { data: { session: okSession }, error: null }; }, async signOut() {}, async refreshSession() { return { data: { session: okSession }, error: null }; } } };
export async function me() { return { email: "staff@example.test", profile: { full_name: "Avery Staff" }, staff: { role: "admin" }, can_admin: true }; }
export async function logout() {}
export async function login() { return { session: okSession }; }
export async function resetPasswordForEmail() { return {}; }
export async function updatePassword() { return {}; }
export async function orders() { return []; }
export async function catalog() { return []; }
export async function getToken() { return "stub-token"; }
// admin.js imports apiBlob for label/CSV downloads. A stub missing any binding the module
// graph imports fails the whole graph to link, so admin never boots and every assertion
// below times out on a selector that was never going to appear.
export async function apiBlob() { return new Blob([""], { type: "application/pdf" }); }
export async function api(path) {
  const pathname = new URL(path, window.location.origin).pathname;
  if (pathname.startsWith("/api/admin/stats")) return { orders: 1, revenue: 0, pending_companies: 1, unread_messages: 0, new_quotes: 0, low_stock: 0, setup_followups: [], recent_orders: [], companies: { pending: 1, approved: 2, suspended: 0 }, accounts: { pending: 1, approved: 2, suspended: 0 }, commerce: {}, crm: {}, catalog_health: {}, analytics: {}, traffic: {}, request_queue: Array.from({ length: 12 }, (_, index) => ({ label: "Follow up with Great Lakes Industrial Water Treatment and Facilities Procurement about a multi-site VertKleen evaluation", value: index + 1, href: index % 2 ? "#quotes" : "#crm" })), staff_context: window.__TEST_STAFF_CONTEXT };
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
  const staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

test("admin top navigation owns the signed-in identity and sign-out action", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      window.__TEST_STAFF_CONTEXT = {
        role: "owner",
        email: "staff@example.test",
        can_write: true,
        capabilities: ["admin.write"],
      };
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      await page.locator(".acct-name").waitFor();

      assert.equal(await page.locator(".acct-name").textContent(), "Avery");
      assert.equal(await page.locator(".nav-signin").count(), 0, "signed-in admin must not retain a Sign in link");
      assert.equal(await page.locator("#admGreeting").count(), 0, "admin body must not duplicate signed-in identity");
      assert.equal(await page.locator("#admLogout").count(), 0, "sign out belongs in the top account menu");
      assert.equal(await page.locator("#admRoleBadge").textContent(), "Owner access");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin panel content starts at the sidebar top without inherited section padding", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 2048, height: 768 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      for (const hash of ["orders", "companies", "products", "support-settings", "quotes", "reviews", "newsletter", "crm", "analytics", "finance", "integrations"]) {
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

test("admin sidebar scrolls independently when hovered", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 520 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      const sidebar = page.locator(".adm-sidebar");
      await sidebar.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const rail = document.querySelector(".adm-sidebar");
        if (rail) rail.scrollTop = 0;
      });

      const before = await page.evaluate(() => {
        const rail = document.querySelector(".adm-sidebar");
        const style = rail ? getComputedStyle(rail) : null;
        return {
          canScroll: rail ? rail.scrollHeight > rail.clientHeight : false,
          overflowY: style?.overflowY || "",
          pageY: window.scrollY,
          sidebarY: rail?.scrollTop || 0,
        };
      });
      assert.equal(before.overflowY, "auto", "admin sidebar should own vertical wheel scrolling");
      assert.equal(before.canScroll, true, "admin sidebar should be height-bounded on short desktop viewports");
      assert.equal(before.sidebarY, 0, "test starts with sidebar at top");

      const box = await sidebar.boundingBox();
      assert.ok(box, "admin sidebar should be visible");
      const x = box.x + Math.min(80, box.width / 2);
      const y = Math.min(Math.max(box.y + 40, 20), 500);
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 320);
      await page.waitForFunction(() => document.querySelector(".adm-sidebar")?.scrollTop > 0);

      const after = await page.evaluate(() => ({
        pageY: window.scrollY,
        sidebarY: document.querySelector(".adm-sidebar")?.scrollTop || 0,
      }));
      assert.ok(after.sidebarY > 0, "wheel over sidebar should move the sidebar scroll position");
      assert.equal(after.pageY, before.pageY, "wheel over sidebar should not scroll the active admin panel first");

      const bottomBoundary = await page.evaluate(() => {
        const rail = document.querySelector(".adm-sidebar");
        window.scrollTo(0, 0);
        if (rail) rail.scrollTop = rail.scrollHeight;
        return { pageY: window.scrollY, sidebarY: rail?.scrollTop || 0 };
      });
      await page.evaluate(() => {
        document.querySelector(".adm-sidebar")?.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 320,
        }));
      });
      await page.waitForTimeout(100);
      const afterBottomBoundary = await page.evaluate(() => ({
        pageY: window.scrollY,
        sidebarY: document.querySelector(".adm-sidebar")?.scrollTop || 0,
      }));
      assert.equal(afterBottomBoundary.sidebarY, bottomBoundary.sidebarY, "admin sidebar should stay at its bottom boundary");
      assert.ok(afterBottomBoundary.pageY > bottomBoundary.pageY, "wheel should continue into the page at the admin sidebar bottom");

      const topBoundary = await page.evaluate(() => {
        const rail = document.querySelector(".adm-sidebar");
        const maxPageY = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(300, maxPageY));
        if (rail) rail.scrollTop = 0;
        return { pageY: window.scrollY, sidebarY: rail?.scrollTop || 0 };
      });
      assert.ok(topBoundary.pageY > 0, "admin dashboard should have page space above the sidebar");
      await page.evaluate(() => {
        document.querySelector(".adm-sidebar")?.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -320,
        }));
      });
      await page.waitForTimeout(100);
      const afterTopBoundary = await page.evaluate(() => ({
        pageY: window.scrollY,
        sidebarY: document.querySelector(".adm-sidebar")?.scrollTop || 0,
      }));
      assert.equal(afterTopBoundary.sidebarY, topBoundary.sidebarY, "admin sidebar should stay at its top boundary");
      assert.ok(afterTopBoundary.pageY < topBoundary.pageY, "wheel should continue into the page at the admin sidebar top");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("mobile admin navigation stays collapsed until requested and closes after selection", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });

      const toggle = page.locator("#admNavToggle");
      await assert.doesNotReject(() => toggle.waitFor({ state: "visible" }));
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#admNavTabs").isHidden(), true, "mobile section list should not dominate the first screen");

      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#admNavTabs").isVisible(), true);

      await page.locator('[data-tab="orders"]').click();
      await page.waitForSelector('.adm-panel[data-panel="orders"][data-active="true"]');
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#admNavTabs").isHidden(), true);
      assert.equal(await page.locator("#admNavCurrent").textContent(), "Orders");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("read-only staff see their role and cannot trigger mutation controls", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      window.__TEST_STAFF_CONTEXT = { role: "read_only", email: "viewer@example.test", can_write: false, capabilities: [] };
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#products`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="products"][data-active="true"]', { timeout: 10000 });
      await page.waitForFunction(() => document.getElementById("admRoleBadge")?.textContent === "Read only access");

      assert.equal(await page.locator("#admRoleHint").textContent(), "Viewing only. Mutation controls are disabled.");
      assert.equal(await page.locator(".adm-order-create").isHidden(), true);
      assert.equal(await page.locator('[data-capability="product.write"][data-capability-mode="hide"]').first().isHidden(), true);
      assert.equal(await page.locator("#invApply").isDisabled(), true);
      assert.match(await page.locator("#invApply").getAttribute("title"), /staff write access/);
      assert.equal(await page.locator("#qboConnect").isDisabled(), true);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin dialogs return focus to their invoking control", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      await page.evaluate(async () => {
        const trigger = document.createElement("button");
        trigger.id = "focus-return-trigger";
        trigger.textContent = "Open confirmation";
        document.body.appendChild(trigger);
        trigger.focus();
        const { confirmDialog } = await import("/js/util.js");
        window.__focusDialogResult = "pending";
        confirmDialog("Confirm focus return?").then((result) => { window.__focusDialogResult = result; });
      });
      await page.locator('.confirm-dialog button[value="cancel"]').click();
      await page.waitForFunction(() => window.__focusDialogResult === false);
      await page.waitForFunction(() => document.activeElement?.id === "focus-return-trigger");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "focus-return-trigger");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin shell reflows at the 400-percent zoom equivalent", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      for (const hash of ["overview", "analytics", "finance", "integrations", "products"]) {
        await page.goto(`${BASE_URL}/admin.html#${hash}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(`.adm-panel[data-panel="${hash}"][data-active="true"]`, { timeout: 10000 });
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        assert.ok(overflow <= 2, `${hash} creates ${overflow}px of page-level horizontal overflow at 320 CSS px`);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("core admin helper text meets WCAG AA text contrast", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      const samples = await page.evaluate(() => {
        const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = ([r, g, b]) => {
          const linear = [r, g, b].map((n) => {
            const channel = n / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const background = (element) => {
          let node = element;
          while (node) {
            const value = getComputedStyle(node).backgroundColor;
            if (value && !/rgba?\(0, 0, 0(?:, 0)?\)/.test(value) && value !== "transparent") return parse(value);
            node = node.parentElement;
          }
          return [255, 255, 255];
        };
        const selectors = ["#admRoleHint", ".adm-nav-group > span", ".adm-overview-head .muted", ".adm-overview-marker span", ".adm-eyebrow"];
        return selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
          .filter((element) => element.getClientRects().length)
          .map((element) => {
            const fg = parse(getComputedStyle(element).color);
            const bg = background(element);
            const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
            return { selector: element.id ? `#${element.id}` : element.className, ratio: (light + 0.05) / (dark + 0.05) };
          });
      });
      assert.ok(samples.length >= 5, "expected representative helper-text samples");
      for (const sample of samples) assert.ok(sample.ratio >= 4.5, `${sample.selector} contrast is ${sample.ratio.toFixed(2)}:1`);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("production-shaped action density and long labels remain scannable on mobile", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      await page.waitForFunction(() => document.querySelectorAll(".adm-action-item").length === 12);
      const metrics = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".adm-action-item")];
        return {
          count: rows.length,
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          clipped: rows.filter((row) => row.scrollWidth - row.clientWidth > 2).length,
          minHeight: Math.min(...rows.map((row) => row.getBoundingClientRect().height)),
        };
      });
      assert.equal(metrics.count, 12);
      assert.ok(metrics.pageOverflow <= 2, `dense action inbox creates ${metrics.pageOverflow}px page overflow`);
      assert.equal(metrics.clipped, 0, "long action labels should wrap inside their rows");
      assert.ok(metrics.minHeight >= 40, "dense rows should retain usable touch height");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin status changes are exposed through a live region", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#finance`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="finance"][data-active="true"]', { timeout: 10000 });
      const status = page.locator("#repResult");
      assert.equal(await status.getAttribute("role"), "status");
      assert.equal(await status.getAttribute("aria-live"), "polite");
      await page.locator("#repRun").click();
      await page.waitForFunction(() => document.getElementById("repResult")?.textContent.includes("Revenue"));
      assert.match(await status.textContent(), /Revenue .* Tax .* paid .* AOV/);
      assert.equal(await status.getAttribute("data-state"), "ok");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

test("admin boots when an older unversioned util module remains cached", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
      window.MASEST_SUPABASE_ANON = "stub-anon";
      localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
    });
    await context.route("**/js/auth.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: authModule }));
    await context.route("**/js/util.js*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.searchParams.has("v")) return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: "export const esc = (value) => String(value ?? '');",
      });
    });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/admin.html#overview`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.adm-panel[data-panel="overview"][data-active="true"]', { timeout: 10000 });
      assert.equal(await page.locator("#admApp").isVisible(), true, "versioned admin dependencies should bypass a stale util.js cache entry");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
