// Contract spec for the pricing_tier CMS type: programs.html mounts
// data-cms-content="pricing_tiers" (replace mode) over the hardcoded tier cards.
// A published snapshot replaces the fallback; an empty/missing snapshot leaves the
// hardcoded tiers untouched. Mirrors the static-server harness used by content-smoke.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4273;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIR = "output/playwright/pricing-cms";
let server;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${BASE_URL}/programs.html`).catch(() => null);
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

const PRICING = {
  pricing_tiers: [
    { slug: "managed-starter", name: "Managed Starter", badge: "Starter", audience: "Single-site pilots", price: "$420-780", price_unit: "/ mo", annual: "$5K-9.4K / yr", features: ["VertKleen core line", "Quarterly audit"], replaces: "Replaces commodity programs", cta: "Quote Starter", href: "contact?type=quote", sort_order: 1, active: true },
    { slug: "managed-pro", name: "Managed Pro", badge: "Pro · Most chosen", audience: "Districts & hospitals", price: "$1,400-3,200", price_unit: "/ mo", annual: "$16.8K-38K / yr", features: ["Everything in Starter", "Glycol management", "WMP support"], replaces: "Displaces Nalco / Ecolab", cta: "Quote Pro", href: "contact?type=quote", featured: true, sort_order: 2, active: true },
  ],
};

test("published pricing_tiers replace the hardcoded fallback tiers on programs.html", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/data/content/pricing.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(PRICING),
  }));
  await page.goto(`${BASE_URL}/programs.html`, { waitUntil: "networkidle" });

  const grid = page.locator('.tier-grid[data-cms-content="pricing_tiers"]');
  await expect(grid).toBeVisible();
  // CMS tiers rendered…
  await expect(grid.locator(".tier-card")).toHaveCount(2);
  await expect(grid.getByText("Managed Pro")).toBeVisible();
  await expect(grid.locator(".tier-card.featured")).toHaveCount(1);
  await expect(grid.locator(".tier-card.featured")).toContainText("Managed Pro");
  // …and the hardcoded fallback (Bronze/Essentials) is gone under replace mode.
  await expect(grid.getByText("Essentials", { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, "programs.html must not overflow horizontally with CMS tiers").toBeFalsy();
  await page.locator(".tier-grid").screenshot({ path: `${DIR}/programs-cms-tiers.png` });
});

test("empty pricing snapshot leaves the hardcoded fallback tiers intact", async ({ page }) => {
  await page.route("**/data/content/pricing.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ pricing_tiers: [] }),
  }));
  await page.goto(`${BASE_URL}/programs.html`, { waitUntil: "networkidle" });
  const grid = page.locator('.tier-grid[data-cms-content="pricing_tiers"]');
  await expect(grid.getByText("Essentials", { exact: true })).toBeVisible();
  await expect(grid.locator(".tier-card")).toHaveCount(4);
});
