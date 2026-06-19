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

  expect(watermark.content).toBe("none");
  expect(watermark.display).toBe("none");
  expect(watermark.opacity).toBe(0);
});

test("HMIS story keeps copy separated from the hazard card on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  await expect(page.locator('.story .act[data-act="3"] .hmis-card')).toHaveCount(1);
  await expect(page.locator('.story .act[data-act="3"] .hmis-diamond')).toHaveCount(1);
  await expect(page.locator(".savior-zero-scale .zero-axis")).toHaveCount(3);

  await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + window.innerHeight * 0.42);
  });
  await page.waitForTimeout(300);

  const layout = await page.evaluate(() => {
    const copy = document.querySelector('.story .act[data-act="3"] .act-copy.top');
    const rig = document.querySelector('.story .act[data-act="3"] .hmis-rig');
    const copyBox = copy.getBoundingClientRect();
    const rigBox = rig.getBoundingClientRect();
    return {
      copyBottom: copyBox.bottom,
      rigTop: rigBox.top,
      rigBottom: rigBox.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.rigTop - layout.copyBottom).toBeGreaterThanOrEqual(28);
  expect(layout.rigBottom).toBeLessThan(layout.viewportHeight + 120);
});

test("HMIS hazard card stacks without clipping on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const layout = await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.52);
    const cards = [...document.querySelectorAll('.story .act[data-act="3"] .hmis-card, .story .act[data-act="3"] .hmis-diamond')]
      .map((card) => {
        const box = card.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
        };
      });
    return {
      viewportWidth: window.innerWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards,
    };
  });

  expect(layout.overflowX).toBe(0);
  expect(layout.cards).toHaveLength(2);
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(card.width).toBeGreaterThan(180);
  }
});

test("conventional cleaner scene shows four hazard cards and final zero transition", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".act-chems .chem-rig")).toHaveCount(1);
  await expect(page.locator(".act-chems .chem-card")).toHaveCount(4);
  await expect(page.locator(".act-chems .chem-out")).toHaveText(/3 for health/);
  await expect(page.locator(".act-chems .chem-final")).toHaveText(/zero/);

  const cards = await page.locator(".act-chems .chem-card").evaluateAll((items) => (
    items.map((card) => {
      const box = card.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        visible: window.getComputedStyle(card).display !== "none",
      };
    })
  ));

  for (const card of cards) {
    expect(card.visible).toBe(true);
    expect(card.width).toBeGreaterThan(300);
    expect(card.height).toBeGreaterThan(80);
  }
});
