import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4194;
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

test("story scene watermarks are removed from the visual layer", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const watermark = await page.locator('.story .act[data-act="3"]').evaluate((act) => {
    const style = window.getComputedStyle(act, "::before");
    return {
      content: style.content,
      display: style.display,
      opacity: Number(style.opacity),
    };
  });

  expect(watermark.display).toBe("none");
  expect(watermark.content).toBe("none");
  expect(watermark.opacity).toBe(0);
});

test("HMIS story has separated copy, hot hazard axes, and cool zero axes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + window.innerHeight * 0.42);
  });
  await page.waitForTimeout(700);

  await expect(page.locator(".hmis-meter .mcol")).toHaveCount(3);
  await expect(page.locator(".savior-zero-scale .zero-axis")).toHaveCount(3);

  const layout = await page.evaluate(() => {
    const copy = document.querySelector('.story .act[data-act="3"] .act-copy.top');
    const rig = document.querySelector('.story .act[data-act="3"] .hmis-rig');
    const scale = document.querySelector(".hmis-meter");
    const copyBox = copy.getBoundingClientRect();
    const rigBox = rig.getBoundingClientRect();
    const scaleBox = scale.getBoundingClientRect();
    return {
      copyBottom: copyBox.bottom,
      rigTop: rigBox.top,
      scaleTop: scaleBox.top,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.rigTop - layout.copyBottom).toBeGreaterThanOrEqual(28);
  expect(layout.scaleTop).toBeLessThan(layout.viewportHeight - 90);
});

test("conventional cleaner scene has a hazard field that cools in the safe state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".chem-scale .hazard-field")).toHaveCount(1);
  await expect(page.locator(".chem-scale .hazard-field i")).toHaveCount(4);

  const states = await page.locator(".chem-scale").evaluate((scale) => {
    const field = scale.querySelector(".hazard-field");
    const beforeHot = window.getComputedStyle(field, "::before").backgroundImage;
    scale.classList.add("safe");
    const safeBackground = window.getComputedStyle(field).backgroundImage;
    const beforeSafe = window.getComputedStyle(field, "::before").backgroundImage;
    return {
      safeClass: scale.classList.contains("safe"),
      beforeHot,
      safeBackground,
      beforeSafe,
    };
  });

  expect(states.safeClass).toBe(true);
  expect(states.beforeHot).toContain("255");
  expect(states.safeBackground).toContain("211");
  expect(states.beforeSafe).toContain("255");
});
