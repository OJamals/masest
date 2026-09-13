import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

// Drives the real order editor and create form in admin.html against stubbed staff APIs.
// Order *edit* used to ask staff to paste a raw company UUID while order *creation* had a
// business search; both now share one picker. The case that matters is the one a unit test
// can only describe: pick a search result, search again for something that excludes it, and
// save — the order must keep its own business, not become a guest order.
const PORT = 4330;
const BASE_URL = "http://127.0.0.1:" + PORT;
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const ACME = { id: "11111111-1111-4111-8111-111111111111", name: "Acme HVAC", status: "approved" };
const BRIGHT = { id: "22222222-2222-4222-8222-222222222222", name: "Bright Marine", status: "approved" };
const COASTAL = { id: "33333333-3333-4333-8333-333333333333", name: "Coastal Labs", status: "pending" };
const COMPANIES = [ACME, BRIGHT, COASTAL];
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(BASE_URL + "/admin.html");
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

// A pending NET order with no Stripe intent and no QuickBooks document is what
// draftEditable() lets staff edit.
const draftOrder = {
  id: ORDER_ID,
  order_number: "MST-3001",
  user_id: "",
  company_id: ACME.id,
  company_name: ACME.name,
  companies: { name: ACME.name },
  customer_email: "buyer@acme.test",
  status: "pending_payment",
  payment_method: "net",
  subtotal: 46.49,
  tax: 0,
  total: 46.49,
  currency: "usd",
  created_at: "2026-09-12T14:00:00Z",
  order_items: [{ sku: "MW-1G", product_sku: "multiwash", name: "VertKleen MultiWash", qty: 1, unit_price: 46.49, line_total: 46.49 }],
};

async function boot(page) {
  const saved = [];
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route("**/api/admin/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }));
  // The editor sits inside data-capability-scope="order.write"; without that capability its
  // inputs are disabled rather than hidden, and typing would silently do nothing.
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ staff_context: { email: "staff@masest.test", role: "owner", capabilities: ["admin.write", "order.write"] } }),
  }));
  await page.route("**/api/admin/orders**", (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      saved.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, order: draftOrder }) });
    }
    const url = new URL(request.url());
    if (url.searchParams.get("view")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [], orders: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [draftOrder], total: 1, has_more: false }) });
  });
  await page.route("**/api/admin/companies**", (route) => {
    const term = (new URL(route.request().url()).searchParams.get("search") || "").toLowerCase();
    const companies = COMPANIES.filter((company) => company.name.toLowerCase().includes(term));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ companies, total: companies.length, has_more: false }) });
  });
  return saved;
}

async function openEditor(page) {
  await page.goto(BASE_URL + "/admin.html#orders");
  const row = page.locator(".adm-order-manage").first();
  await row.locator("summary").first().click();
  const editor = row.locator(".adm-order-editor");
  await editor.locator("summary").first().click();
  return editor;
}

test("order edit picks a business by name and keeps the order's own business through a second search", async ({ page }) => {
  const saved = await boot(page);
  const editor = await openEditor(page);

  await expect(editor).not.toContainText("Company ID");
  const search = editor.locator("[data-edit-company-search]");
  const select = editor.locator("select[data-edit-company]");
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue(ACME.id);

  await search.fill("bri");
  await expect(select.locator("option")).toHaveCount(3);
  await expect(select.locator("option", { hasText: "Bright Marine" })).toHaveCount(1);
  await expect(select).toHaveValue(ACME.id);

  await select.selectOption(BRIGHT.id);
  await search.fill("coa");
  await expect(select.locator("option", { hasText: "Coastal Labs (pending)" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: "Bright Marine" })).toHaveCount(0);
  // Bright is no longer offered. Falling back to guest here would strip the business on save.
  await expect(select).toHaveValue(ACME.id);

  await select.selectOption(COASTAL.id);
  await editor.locator("[data-save-order-edit]").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].action).toBe("update_order");
  expect(saved[0].company_id).toBe(COASTAL.id);
});

test("clearing the edit search leaves the order's business selected for save", async ({ page }) => {
  const saved = await boot(page);
  const editor = await openEditor(page);
  const search = editor.locator("[data-edit-company-search]");
  const select = editor.locator("select[data-edit-company]");

  await search.fill("bri");
  await expect(select.locator("option", { hasText: "Bright Marine" })).toHaveCount(1);
  await search.fill("");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(select).toHaveValue(ACME.id);

  await editor.locator("[data-save-order-edit]").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].company_id).toBe(ACME.id);
});

test("a slow earlier search cannot overwrite a newer one", async ({ page }) => {
  // The lookup is debounced and asynchronous, so a response for an old term can land after
  // the response for the term the user is now looking at. It has to be discarded.
  await boot(page);
  let staleDelivered = false;
  await page.route("**/api/admin/companies**", async (route) => {
    const term = (new URL(route.request().url()).searchParams.get("search") || "").toLowerCase();
    const companies = COMPANIES.filter((company) => company.name.toLowerCase().includes(term));
    const body = JSON.stringify({ companies, total: companies.length, has_more: false });
    if (term === "bri") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 200, contentType: "application/json", body });
      staleDelivered = true;
      return;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  const editor = await openEditor(page);
  const search = editor.locator("[data-edit-company-search]");
  const select = editor.locator("select[data-edit-company]");

  await search.fill("bri");
  await page.waitForTimeout(400); // past the 220ms debounce, so the slow request is in flight
  await search.fill("coa");
  await expect(select.locator("option", { hasText: "Coastal Labs (pending)" })).toHaveCount(1);

  await expect.poll(() => staleDelivered, { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(300);
  await expect(select.locator("option", { hasText: "Bright Marine" })).toHaveCount(0);
  await expect(select.locator("option", { hasText: "Coastal Labs (pending)" })).toHaveCount(1);
  await expect(select).toHaveValue(ACME.id);
});

test("order creation still finds a business by name through the shared picker", async ({ page }) => {
  await boot(page);
  await page.goto(BASE_URL + "/admin.html#orders");
  await page.locator(".adm-order-create summary").click();
  const select = page.locator("#ordCreateCompany");
  await page.locator("#ordCreateCompanySearch").fill("mar");
  await expect(select.locator("option", { hasText: "Bright Marine" })).toHaveCount(1);
  await select.selectOption(BRIGHT.id);
  await expect(select).toHaveValue(BRIGHT.id);
});
