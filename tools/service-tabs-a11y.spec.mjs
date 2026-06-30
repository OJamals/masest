// Contract spec for the services-catalog tablist keyboard support (WAI-ARIA APG):
// services.html renders role="tablist" with role="tab" buttons; only the selected
// tab is in the tab order (roving tabindex), and Arrow/Home/End move + activate the
// tabs with wrap-around. Guards the a11y fix in js/main/service-catalog.js.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4291;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIR = "output/playwright/service-tabs";
let server;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${BASE_URL}/services.html`).catch(() => null);
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

test("services tablist supports roving tabindex + arrow/Home/End keyboard nav", async ({ page }) => {
  await page.goto(`${BASE_URL}/services.html`, { waitUntil: "networkidle" });
  const tablist = page.locator('[role="tablist"]');
  await expect(tablist).toBeVisible();
  const tabs = tablist.locator('[role="tab"]');
  const count = await tabs.count();
  expect(count, "needs at least 2 tabs to test arrow nav").toBeGreaterThan(1);

  // Roving tabindex: only the selected (first) tab is in the tab order at rest.
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "0");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");

  // ArrowRight from the first tab moves focus + selection to the second, and its panel shows.
  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  const panel1 = page.locator(`#${(await tabs.nth(1).getAttribute("aria-controls"))}`);
  await expect(panel1).toBeVisible();

  // ArrowLeft from the first tab wraps to the last.
  await tabs.nth(0).focus();
  await tabs.nth(0).click();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(count - 1)).toBeFocused();
  await expect(tabs.nth(count - 1)).toHaveAttribute("aria-selected", "true");

  // Home / End jump to the ends.
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.nth(count - 1)).toBeFocused();

  // Exactly one panel visible at a time.
  const panels = page.locator('[role="tabpanel"]');
  const visible = await panels.evaluateAll((els) => els.filter((e) => !e.hidden).length);
  expect(visible).toBe(1);
});
