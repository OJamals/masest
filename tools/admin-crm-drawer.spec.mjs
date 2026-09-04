import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

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
  await waitForHttpServer(`${BASE_URL}/admin.html`);
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
  await page.route("**/api/admin/messages**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ messages: [], unread: 0 }),
  }));
  await page.route("**/api/admin/users**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ users: [], total: 0, has_more: false }),
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
  // #acctToggle is static markup in admin.html, so "Businesses & approvals" is clickable
  // from first paint — but its delegation is attached by wireCompanies(), which only runs
  // once the LAZY companies feature module loads. A click in that window is dropped with no
  // retry: the sub-view stays on Users and the company list never arrives. data-active is
  // set by setTab before the module is even requested, so it cannot prove the toggle is
  // live. showAcctView flips aria-pressed synchronously on a click that registered, so
  // clicking until it is set is the reliable gate.
  const businesses = page.getByRole("button", { name: "Businesses & approvals" });
  await expect(businesses).toBeVisible();
  await expect(async () => {
    if ((await businesses.getAttribute("aria-pressed")) !== "true") await businesses.click();
    await expect(businesses).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 15000 });

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

test("contact CSV import previews and requires confirmation before writing", async ({ page }) => {
  await bootAsStaff(page);
  const consoleProblems = [];
  const networkProblems = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) networkProblems.push(`${response.status()} ${response.url()}`);
  });

  await page.route("**/api/admin/companies**", (route) =>
    route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));
  await page.route("**/api/admin/company**", (route) =>
    route.fulfill(json({ company: COMPANY, members: [], invites: [], orders: [], message_count: 0 })));
  await page.route("**/api/admin/crm/timeline**", (route) => route.fulfill(json({ timeline: [] })));
  await page.route("**/api/admin/crm/tasks**", (route) => route.fulfill(json({ tasks: [] })));
  await page.route("**/api/admin/crm/notes**", (route) => route.fulfill(json({ notes: [] })));

  const actions = [];
  let imported = false;
  await page.route("**/api/admin/crm/contacts**", (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill(json({
        contacts: imported
          ? [{ id: 1, name: "Jane Buyer", email: "jane@example.com", role: "procurement" }]
          : [],
      }));
    }
    const body = JSON.parse(req.postData() || "{}");
    actions.push(body.action);
    if (body.action === "preview_import") {
      return route.fulfill(json({
        ok: true,
        preview: true,
        total: 2,
        ready: 1,
        skipped: 1,
        skipped_duplicates: 1,
        skipped_by_reason: { duplicate_email: 1 },
        errors: [],
      }));
    }
    if (body.action === "import") {
      imported = true;
      return route.fulfill(json({ ok: true, inserted: 1, skipped: 1, skipped_duplicates: 1, errors: [] }));
    }
    return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "unexpected_action" }) });
  });

  await page.goto(`${BASE_URL}/admin.html#companies`, { waitUntil: "domcontentloaded" });
  const businesses = page.getByRole("button", { name: "Businesses & approvals" });
  await expect(async () => {
    if ((await businesses.getAttribute("aria-pressed")) !== "true") await businesses.click();
    await expect(businesses).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.locator('[data-open-company="co-1"]').click();
  await page.locator('.crm-panel [data-crm-tab="contacts"]').click();

  const input = page.locator('[data-crm-contact-import]');
  const csv = { name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from("name,email\nJane Buyer,jane@example.com\nDuplicate,old@example.com") };
  await input.setInputFiles(csv);
  await expect(page.locator(".confirm-dialog-msg")).toContainText("Import 1 of 2 contacts into this account?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => actions).toEqual(["preview_import"]);

  await input.setInputFiles(csv);
  await expect(page.locator(".confirm-dialog-msg")).toContainText("does not subscribe anyone to marketing email");
  await expect(page.locator(".confirm-dialog-msg")).toContainText("1 duplicate email");
  await expect(page.getByRole("button", { name: "Import contacts" })).toBeFocused();
  if (process.env.MASEST_QA_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.MASEST_QA_SCREENSHOT_DIR}/crm-contact-import-preview-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.MASEST_QA_SCREENSHOT_DIR}/crm-contact-import-preview-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.keyboard.press("Enter");
  await expect.poll(() => actions).toEqual(["preview_import", "preview_import", "import"]);
  await expect(page.locator('[data-crm-body] .adm-status[data-state="ok"]')).toContainText("Imported 1, skipped 1.");
  await expect(page.locator('[data-crm-contact-history="1"]')).toBeVisible();
  expect(networkProblems).toEqual([]);
  expect(consoleProblems).toEqual([]);
});
