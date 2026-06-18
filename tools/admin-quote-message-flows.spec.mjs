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
  server.kill();
  await once(server, "exit").catch(() => {});
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
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({}),
  }));
}

test("staff converts a quote into a NET order with the expected payload", async ({ page }) => {
  await bootAsStaff(page);

  // Company list feeds the "Convert to order for…" dropdown.
  await page.route("**/api/admin/companies**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ companies: [{ id: "co-1", name: "Acme Mfg", status: "active" }] }),
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
  // Convert controls live inside a collapsed <details>; expand it before interacting.
  await page.locator(".quote-item summary").first().click();
  await expect(page.locator('[data-convert="q-1"]')).toBeVisible();

  const conv = (k) => page.locator(`[data-conv-${k}="q-1"]`);
  await conv("co").selectOption("co-1");
  await conv("sku").fill("GLY-PG-55");
  await conv("name").fill("PG Glycol Drum");
  await conv("qty").fill("4");
  await conv("price").fill("289.50");

  const convResp = page.waitForResponse((r) => r.url().includes("/api/admin/quotes") && r.request().method() === "POST");
  await page.locator('[data-convert="q-1"]').click();
  await convResp;

  // The client posts raw input strings for qty/unit_price; the function coerces them server-side.
  expect(convertBody).toEqual({
    id: "q-1",
    action: "convert",
    company_id: "co-1",
    items: [{ sku: "GLY-PG-55", name: "PG Glycol Drum", qty: "4", unit_price: "289.50" }],
  });
  await expect(page.locator("#qStatus")).toHaveText("Order ord-99 created.");
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
        body: JSON.stringify({ messages: [{ id: "m-1", sender_role: "buyer", body: "When does my order ship?", created_at: "2026-06-18T10:00:00Z" }] }),
      });
    }
    // Thread list.
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ threads: [{ company_id: "co-1", company_name: "Acme Mfg", last_body: "When does my order ship?", unread: 1 }] }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#messages`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();

  await page.locator('[data-company-thread="co-1"]').click();
  await expect(page.locator("#replyForm")).toBeVisible();
  await page.locator("#replyBody").fill("Ships Friday via LTL freight.");

  const replyResp = page.waitForResponse((r) => r.url().includes("/api/admin/messages") && r.request().method() === "POST");
  await page.locator('#replyForm button[type="submit"]').click();
  await replyResp;

  expect(replyBody).toEqual({ company_id: "co-1", body: "Ships Friday via LTL freight." });
});
