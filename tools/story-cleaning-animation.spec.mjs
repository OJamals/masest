import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4196;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/index.html`).catch(() => null);
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

test("chemical story keeps the hazard scale visible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html#hold4`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const box = await page.locator(".act-chems .chem-scale").boundingBox();
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThan(812);
});

test("zero story shows water-like lift and rinse over proof results", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html#hold5`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  await expect(page.locator(".cleaning-lift")).toHaveCount(1);
  await expect(page.locator(".cleaning-rinse")).toHaveCount(1);
  await expect(page.locator(".cleaning-lift .soil-mote")).toHaveCount(10);
  await expect(page.locator(".savior-proof .proof-wipe")).toHaveCount(3);

  const layer = await page.locator(".cleaning-lift").evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      label: el.getAttribute("aria-label"),
      display: style.display,
      pointerEvents: style.pointerEvents,
    };
  });
  expect(layer.label).toContain("Water-like cleaning action");
  expect(layer.display).not.toBe("none");
  expect(layer.pointerEvents).toBe("none");
});
