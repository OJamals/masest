import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

// Playwright contract spec for the slice-2 deal pipeline (board + drawer).
// Reuses the static-server + stubbed-API harness from admin-crm-drawer.spec.mjs:
// boots admin.js past the Supabase gate, drives Quotes tab → Board toggle →
// 6 stage columns → open a card → deal drawer with 4 sub-tabs → Notes composer.
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
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

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
const QUOTE = {
  id: "q-1", type: "quote", name: "Pat Buyer", email: "pat@acme.co", company: "Acme HVAC",
  status: "new", priority: "high", pipeline_stage: "qualified", deal_value: 4200, next_step: "", notes: "",
};
const SUMMARY = {
  stages: [
    { stage: "new", count: 0, value: 0 }, { stage: "qualified", count: 1, value: 4200 },
    { stage: "sample_audit", count: 0, value: 0 }, { stage: "proposal", count: 0, value: 0 },
    { stage: "won", count: 0, value: 0 }, { stage: "lost", count: 0, value: 0 },
  ],
  weighted: 1260, open_value: 4200,
};

test("quotes board renders 6 stage columns and opens a deal drawer", async ({ page }) => {
  await bootAsStaff(page);

  await page.route("**/api/admin/quotes**", (route) => {
    const url = route.request().url();
    if (route.request().method() === "POST") return route.fulfill(json({ ok: true, quote: QUOTE }));
    if (url.includes("view=pipeline")) return route.fulfill(json({ summary: SUMMARY }));
    return route.fulfill(json({ quotes: [QUOTE], total: 1, has_more: false, new_count: 1, urgent_count: 0 }));
  });
  await page.route("**/api/admin/companies**", (route) => route.fulfill(json({ companies: [], total: 0, has_more: false })));
  await page.route("**/api/admin/crm/timeline**", (route) => route.fulfill(json({ timeline: [] })));
  await page.route("**/api/admin/crm/tasks**", (route) => route.fulfill(json({ tasks: [] })));
  await page.route("**/api/admin/crm/notes**", (route) => route.fulfill(json({ notes: [] })));

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();

  // List renders first; flip to the Board view.
  await expect(page.locator('.pipe-toggle [data-view="board"]')).toBeVisible();
  await page.locator('.pipe-toggle [data-view="board"]').click();

  // Six stage columns + a forecast strip.
  await expect(page.locator(".pipe-col")).toHaveCount(6);
  await expect(page.locator(".pipe-forecast")).toBeVisible();
  await expect(page.locator('.pipe-card[data-card-id="q-1"]')).toBeVisible();

  // Open the deal drawer: Details form + the reused CRM panel (its own 3 sub-tabs).
  await page.locator('.pipe-card[data-card-id="q-1"]').click();
  await expect(page.locator('.adm-drawer[data-quote-drawer]')).toBeVisible();
  await expect(page.locator('.adm-drawer [data-d-stage]')).toBeVisible();
  await expect(page.locator('.adm-drawer [data-drawer-convert]')).toBeVisible();
  for (const tab of ["timeline", "tasks", "notes"]) {
    await expect(page.locator(`.adm-drawer .crm-panel [data-crm-tab="${tab}"]`)).toBeVisible();
  }

  // The CRM panel's Notes sub-tab renders the note composer.
  await page.locator('.adm-drawer .crm-panel [data-crm-tab="notes"]').click();
  await expect(page.locator('.adm-drawer [data-crm-note-body]')).toBeVisible();
});

const REPORT = {
  kpis: { open_count: 4, open_value: 39100, weighted: 35550, win_rate: 0.5, won_count: 1, won_value: 12000, lost_count: 1, avg_deal: 9100 },
  funnel: [
    { stage: "new", reached: 7, rate: 1 }, { stage: "qualified", reached: 6, rate: 0.857 },
    { stage: "sample_audit", reached: 4, rate: 0.667 }, { stage: "proposal", reached: 3, rate: 0.75 },
    { stage: "won", reached: 1, rate: 0.333 },
  ],
  forecast_months: [
    { month: "2026-07", value: 11800, weighted: 4540, count: 2 },
    { month: "2026-08", value: 26000, weighted: 18200, count: 1 },
    { month: "unscheduled", value: 1300, weighted: 650, count: 1 },
  ],
  loss_reasons: [{ reason: "price", count: 1 }],
};

test("quotes reports view renders KPIs, funnel and forecast", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/quotes**", (route) => {
    const url = route.request().url();
    if (url.includes("view=report")) return route.fulfill(json({ report: REPORT }));
    if (url.includes("view=pipeline")) return route.fulfill(json({ summary: SUMMARY }));
    return route.fulfill(json({ quotes: [QUOTE], total: 1, has_more: false, new_count: 1, urgent_count: 0 }));
  });
  await page.route("**/api/admin/companies**", (route) => route.fulfill(json({ companies: [], total: 0, has_more: false })));

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('.pipe-toggle [data-view="report"]').click();

  await expect(page.locator(".pipe-kpis .pipe-kpi")).toHaveCount(6);
  await expect(page.locator(".pipe-report-block").filter({ hasText: "Conversion funnel" })).toBeVisible();
  await expect(page.locator(".pipe-bar-fill").first()).toBeVisible();
  await expect(page.locator(".pipe-report-block").filter({ hasText: "close month" })).toBeVisible();
  await expect(page.locator(".pipe-loss .pipe-chip")).toHaveCount(1);
});

test("quotes list bulk action posts an ids array", async ({ page }) => {
  await bootAsStaff(page);
  let captured = null;
  await page.route("**/api/admin/quotes**", (route) => {
    const url = route.request().url();
    if (route.request().method() === "POST") {
      captured = JSON.parse(route.request().postData() || "{}");
      return route.fulfill(json({ ok: true, updated: 1 }));
    }
    if (url.includes("view=pipeline")) return route.fulfill(json({ summary: SUMMARY }));
    return route.fulfill(json({ quotes: [QUOTE], total: 1, has_more: false, new_count: 1, urgent_count: 0 }));
  });
  await page.route("**/api/admin/companies**", (route) => route.fulfill(json({ companies: [], total: 0, has_more: false })));

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await page.locator('.q-check[value="q-1"]').check();
  await page.locator("#qBulkStage").selectOption("proposal");
  await page.locator("#qBulkApply").click();

  await expect.poll(() => captured).not.toBeNull();
  expect(captured).toMatchObject({ ids: ["q-1"], pipeline_stage: "proposal" });
});
