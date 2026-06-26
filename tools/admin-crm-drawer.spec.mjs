import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// Playwright contract spec for the CRM drawer panel (Task 5).
// Boots admin.js past the Supabase sign-in gate using the same static-server +
// stubbed-API harness as admin-quote-message-flows.spec.mjs (verbatim).
// Drives: companies tab → open company detail → CRM panel tabs visible →
// click Notes → fill/submit note form → asserts POST body contract.
const PORT = 4188;
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
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({}),
  }));
}

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const COMPANY = { id: "co-1", name: "Acme HVAC", status: "approved", setup: { steps: [] } };

test("company drawer shows CRM tabs and posts a note", async ({ page }) => {
  await bootAsStaff(page);

  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));

  await page.route("**/api/admin/company**", (route) =>
    route.fulfill(json({ company: COMPANY, members: [], invites: [], orders: [], message_count: 0 })));

  await page.route("**/api/admin/crm/timeline**", (route) =>
    route.fulfill(json({ timeline: [] })));

  await page.route("**/api/admin/crm/tasks**", (route) =>
    route.fulfill(json({ tasks: [] })));

  let captured = null;
  await page.route("**/api/admin/crm/notes**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      captured = JSON.parse(req.postData() || "{}");
      return route.fulfill(json({ ok: true, note: {} }));
    }
    return route.fulfill(json({ notes: [] }));
  });

  // Navigate directly to the companies tab via hash; domcontentloaded is sufficient
  // because admin.js boot() triggers on DOMContentLoaded + hash determines first tab.
  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();

  // Wait for the company list to render and the open-company button to appear.
  await expect(page.locator('[data-open-company="co-1"]')).toBeVisible();
  await page.locator('[data-open-company="co-1"]').click();

  // CRM panel is mounted after company detail loads; wait for all three tab buttons.
  await expect(page.locator('.crm-panel [data-crm-tab="timeline"]')).toBeVisible();
  await expect(page.locator('.crm-panel [data-crm-tab="tasks"]')).toBeVisible();
  await expect(page.locator('.crm-panel [data-crm-tab="notes"]')).toBeVisible();

  // Switch to Notes tab — triggers GET /api/admin/crm/notes and renders the compose form.
  await page.locator('.crm-panel [data-crm-tab="notes"]').click();

  // Wait for the note form to appear (rendered after notes fetch resolves).
  await expect(page.locator('[data-crm-note-kind]')).toBeVisible();
  await page.locator('[data-crm-note-kind]').selectOption("call");
  await page.locator('[data-crm-note-body]').fill("Called about NET terms");
  await page.locator('.crm-note-form button[type="submit"]').click();

  // POST must be captured before asserting the body.
  await expect.poll(() => captured).not.toBeNull();
  expect(captured).toMatchObject({
    subject_type: "company",
    subject_id: "co-1",
    kind: "call",
    body: "Called about NET terms",
  });
});
