import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// E2e coverage for two staff-console write flows that were previously only static-guarded:
//   1. Quote -> NET order conversion  (admin.js renderQuotes() -> POST /api/admin/quotes action=convert)
//   2. Support-thread reply           (admin.js openThread()   -> POST /api/admin/messages)
// We can't mint a real Supabase staff session here, so we stub the admin API: /api/admin/stats=200
// boots admin.js past the sign-in gate (boot() only gates on stats resolving), and the write
// endpoints capture the request body so the test asserts the CLIENT sends the exact contract the
// Cloudflare function expects. A pass means "booted as staff, drove the UI, posted the right payload".
const PORT = 4189;
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

// Construct the Supabase client (so auth.js getToken() resolves) without real network, and stub
// the staff-only stats probe to 200 so admin.js boot() reveals #admApp instead of the gate.
async function bootAsStaff(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  // No staff_context on purpose: normalizeStaffContext() grants the historical
  // full-owner UI only when the field is absent. Spelling out role:"owner"
  // without a capabilities array fails closed and disables every control.
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({}),
  }));
  // The support console posts inbox presence on open; unrouted it would 501
  // against the static server on every drawer toggle.
  await page.route("**/api/admin/message-settings", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      notify_admin_support_requests: true, notify_admin_messages: false,
    }),
  }));
}

test("staff converts a quote into a NET order with the expected payload", async ({ page }) => {
  await bootAsStaff(page);

  // Company list feeds the drawer's "Convert to order" company dropdown.
  await page.route("**/api/admin/companies**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ companies: [{ id: "co-1", name: "Acme Mfg", status: "active" }] }),
  }));
  await page.route("**/api/admin/crm/timeline**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ timeline: [] }),
  }));
  await page.route("**/api/admin/crm/tasks**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [] }),
  }));
  await page.route("**/api/admin/crm/notes**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ notes: [] }),
  }));

  let convertBody = null;
  await page.route("**/api/admin/quotes**", (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.postDataJSON()?.action === "convert") {
      convertBody = req.postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, order_id: "ord-99" }) });
    }
    // GET (initial render + the re-render after a successful convert)
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        quotes: [{ id: "q-1", name: "Jane Lead", email: "jane@example.com", company: "Lead Co", status: "new", message: "Need 4 drums PG glycol" }],
        new_count: 1,
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  // Conversion now lives in the deal drawer; expand the lead row and open it.
  await page.locator(".quote-item summary").first().click();
  await page.locator('[data-open-quote="q-1"]').click();
  const drawer = page.locator('.adm-drawer[data-quote-drawer]');
  await expect(drawer).toBeVisible();

  await drawer.locator("[data-d-co]").selectOption("co-1");
  await drawer.locator("[data-d-sku]").fill("GLY-PG-55");
  await drawer.locator("[data-d-name]").fill("PG Glycol Drum");
  await drawer.locator("[data-d-qty]").fill("4");
  await drawer.locator("[data-d-price]").fill("289.50");

  const convResp = page.waitForResponse((r) => r.url().includes("/api/admin/quotes") && r.request().method() === "POST");
  await drawer.locator("[data-drawer-convert]").click();
  await convResp;

  // The client posts raw input strings for qty/unit_price; the function coerces them server-side.
  expect(convertBody).toEqual({
    id: "q-1",
    action: "convert",
    company_id: "co-1",
    items: [{ sku: "GLY-PG-55", name: "PG Glycol Drum", qty: "4", unit_price: "289.50" }],
  });
  await expect(drawer.locator("[data-drawer-status]")).toHaveText("Order ord-99 created.");
});

test("staff reviews a requisition workspace and sends all priced lines", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/companies**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ companies: [] }),
  }));
  for (const path of ["timeline", "tasks", "notes"]) {
    await page.route(`**/api/admin/crm/${path}**`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ [path]: [] }),
    }));
  }

  let sendBody = null;
  await page.route("**/api/admin/quotes**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && req.postDataJSON()?.action === "send_quote") {
      sendBody = req.postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          order_id: "draft-2",
          quote: { status: "contacted", pipeline_stage: "proposal" },
        }),
      });
    }
    if (url.searchParams.get("view") === "workspace") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspace: {
            quote_id: "q-req",
            requisition_name: "July plant refill",
            currency: "usd",
            items: [
              { sku: "VK-HCR-5", product_sku: "hcr", name: "VertKleen HCR - 5 gal", qty: 2, unit_price: 45 },
              { sku: "VK-DBNPA-1", product_sku: "dbnpa", name: "VertKleen DBNPA - 1 gal", qty: 1, unit_price: 30 },
            ],
            messages: [{ id: "m-1", sender_role: "buyer", body: "Need delivery by August.", created_at: "2026-07-28T12:00:00Z" }],
            documents: [{ id: "d-1", status: "approved", technical_documents: { title: "HCR SDS", document_type: "sds" } }],
          },
        }),
      });
    }
    if (url.searchParams.get("view") === "contacts") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ company_id: "co-1", contacts: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quotes: [{
          id: "q-req",
          name: "Pat Buyer",
          email: "pat@example.com",
          company: "Buyer Co",
          product: "July plant refill",
          source: "requisition",
          status: "new",
          pipeline_stage: "new",
          payload: { requisition_id: "req-1" },
        }],
        new_count: 1,
      }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await page.locator(".quote-item summary").first().click();
  await page.locator('[data-open-quote="q-req"]').click();
  const drawer = page.locator('.adm-drawer[data-quote-drawer]');
  await expect(drawer.locator("[data-quote-workspace]")).toContainText("July plant refill");
  await expect(drawer.locator("[data-quote-workspace]")).toContainText("Need delivery by August.");
  await expect(drawer.locator("[data-quote-workspace]")).toContainText("HCR SDS");
  await drawer.locator("[data-offer-price]").first().fill("42.50");
  const expiresAtValue = "2099-01-01T12:00";
  const expiresAt = new Date(expiresAtValue).toISOString();
  await drawer.locator("[data-offer-expiry]").fill(expiresAtValue);

  const sendResponse = page.waitForResponse((response) =>
    response.url().includes("/api/admin/quotes") && response.request().postDataJSON()?.action === "send_quote");
  await drawer.locator("[data-send-quote]").click();
  await sendResponse;

  expect(sendBody).toEqual({
    id: "q-req",
    action: "send_quote",
    items: [
      { sku: "VK-HCR-5", product_sku: "hcr", name: "VertKleen HCR - 5 gal", qty: "2", unit_price: "42.50" },
      { sku: "VK-DBNPA-1", product_sku: "dbnpa", name: "VertKleen DBNPA - 1 gal", qty: "1", unit_price: "30" },
    ],
    expires_at: expiresAt,
  });
  await expect(drawer.locator("[data-drawer-status]")).toHaveText("Quote committed. Buyer notification, message, and email are queued for delivery.");
});

test("staff replies to a support thread with the expected payload", async ({ page }) => {
  await bootAsStaff(page);

  let replyBody = null;
  await page.route("**/api/admin/messages**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      replyBody = req.postDataJSON();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "m-2", created_at: "2026-06-18T12:00:00Z" }) });
    }
    if (req.url().includes("company_id=")) {
      // Single-thread view (also re-fetched after the reply posts).
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          thread: { company_id: "co-1", company_name: "Acme Mfg", status: "open" },
          messages: [{ id: "m-1", sender_role: "buyer", body: "When does my order ship?", created_at: "2026-06-18T10:00:00Z" }],
        }),
      });
    }
    // Thread list.
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ threads: [{ company_id: "co-1", company_name: "Acme Mfg", last_body: "When does my order ship?", unanswered: true, status: "open" }] }),
    });
  });

  // #messages is one of the hashes that opens the shared support console. It
  // used to activate a panel holding a second, admin-only inbox; that drawer and
  // its #adminSupportDrawer / #replyForm markup are gone.
  await page.goto(`${BASE_URL}/admin.html#messages`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();

  const drawer = page.locator(".site-support__drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".site-support__launcher")).toHaveCSS("color", "rgb(255, 255, 255)");

  const thread = page.locator('.site-support__thread[data-company-id="co-1"]');
  await expect(thread).toBeVisible();
  await thread.click();

  const reply = page.locator(".site-support__reply");
  await expect(reply).toBeVisible();
  await page.locator("#siteSupportReply").fill("Ships Friday via LTL freight.");

  const replyResp = page.waitForResponse((r) => r.url().includes("/api/admin/messages") && r.request().method() === "POST");
  await reply.locator('button[type="submit"]').click();
  await replyResp;

  expect(replyBody).toEqual({ company_id: "co-1", body: "Ships Friday via LTL freight." });
});
