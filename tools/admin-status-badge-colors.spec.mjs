// Regression guard for the semantic statusBadge() colour map (css/components.css).
// statusBadge() emits `<span class="badge" data-s="<rawValue>">` across quotes
// (priority / status / pipeline_stage), companies, customers and orders. The
// `data-s` hook MUST stay colour-coded so an admin can triage urgent vs low and
// won vs lost at a glance; before the fix every state rendered identical grey.
// Reuses the static-server + null-session admin harness from the other admin specs.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4272;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (r?.ok) return;
    await new Promise((res) => setTimeout(res, 125));
  }
  throw new Error("static server did not start");
});
test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
});

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function bootAsStaff(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill(json({ data: { session: null }, session: null })));
  await page.route("**/api/admin/stats", (route) => route.fulfill(json({})));
}

// One quote per semantic colour bucket so the list renders every band at once.
const QUOTES = [
  { id: "u", type: "quote", name: "U", email: "u@x.co", company: "Urgent Co", status: "new", priority: "urgent", pipeline_stage: "qualified", deal_value: 100 },
  { id: "w", type: "quote", name: "W", email: "w@x.co", company: "Won Co", status: "closed", priority: "high", pipeline_stage: "won", deal_value: 100 },
  { id: "l", type: "quote", name: "L", email: "l@x.co", company: "Lost Co", status: "spam", priority: "low", pipeline_stage: "lost", deal_value: 100 },
];

const bg = (page, sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);

test("statusBadge emits semantically coloured badges (not all neutral grey)", async ({ page }) => {
  await bootAsStaff(page);
  await page.route("**/api/admin/quotes**", (route) => {
    const url = route.request().url();
    if (url.includes("view=")) return route.fulfill(json({ summary: { stages: [], weighted: 0, open_value: 0 }, report: {} }));
    return route.fulfill(json({ quotes: QUOTES, total: QUOTES.length, has_more: false, new_count: 1, urgent_count: 1 }));
  });
  await page.route("**/api/admin/companies**", (route) => route.fulfill(json({ companies: [], total: 0, has_more: false })));

  await page.goto(`${BASE_URL}/admin.html#quotes`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator('.badge[data-s="urgent"]')).toBeVisible();

  const neutral = await bg(page, '.badge[data-s="low"]');      // baseline grey (priority low)
  const urgent = await bg(page, '.badge[data-s="urgent"]');    // danger
  const high = await bg(page, '.badge[data-s="high"]');        // warning
  const won = await bg(page, '.badge[data-s="won"]');          // success
  const qualified = await bg(page, '.badge[data-s="qualified"]'); // accent

  // Each semantic state must differ from the neutral default…
  for (const [name, value] of Object.entries({ urgent, high, won, qualified })) {
    expect(value, `${name} badge must not use the neutral background`).not.toBe(neutral);
  }
  // …and from each other (distinct danger / warning / success / accent bands).
  const distinct = new Set([urgent, high, won, qualified]);
  expect(distinct.size, "urgent/high/won/qualified must be four distinct colours").toBe(4);
});
