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

test("desktop story rail label does not overlap the Act 1 headline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const collision = await page.evaluate(() => {
    const headline = document.querySelector('.story .act[data-act="1"] .act-h');
    const activeLabel = document.querySelector(".story .rail-btn.is-on span");
    const visibleBox = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.05) return null;
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const headlineBox = visibleBox(headline);
    const labelBox = visibleBox(activeLabel);
    if (!headlineBox || !labelBox) return { overlaps: false, headlineBox, labelBox };

    return {
      overlaps: labelBox.left < headlineBox.right
        && labelBox.right > headlineBox.left
        && labelBox.top < headlineBox.bottom
        && labelBox.bottom > headlineBox.top,
      headlineBox,
      labelBox,
    };
  });

  expect(collision.overlaps, JSON.stringify(collision)).toBe(false);
});

test("HMIS story keeps copy separated from category deck on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  await expect(page.locator('.story.story-ready .act[data-act="3"] .hmis-stack')).toBeHidden();
  await expect(page.locator('.story .act[data-act="3"] .hmis-category')).toHaveCount(3);
  await expect(page.locator('.story .act[data-act="3"] .hmis-chemical')).toHaveCount(4);
  await expect(page.locator('.story .act[data-act="3"] .hmis-warning')).toHaveCount(4);
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
  expect(layout.rigBottom).toBeLessThanOrEqual(layout.viewportHeight - 72);

  const chemicalPasses = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="3"]');
    const pauses = [0.34, 0.46, 0.58, 0.7];
    const results = [];
    for (const pause of pauses) {
      window.scrollTo(0, act.offsetTop + act.offsetHeight * pause);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const visibleCards = [...act.querySelectorAll(".hmis-chemical")]
        .map((card) => {
          const box = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          return {
            name: card.querySelector("strong")?.textContent || "",
            opacity: Number(style.opacity),
            top: box.top,
            bottom: box.bottom,
            height: box.height,
          };
        })
        .filter((card) => card.opacity > 0.25);
      results.push({ pause, visibleCards, viewportHeight: window.innerHeight });
    }
    return results;
  });

  for (const pass of chemicalPasses) {
    expect(pass.visibleCards.length, JSON.stringify(pass)).toBeGreaterThan(0);
    for (const card of pass.visibleCards) {
      expect(card.top, JSON.stringify(pass)).toBeGreaterThanOrEqual(0);
      expect(card.bottom, JSON.stringify(pass)).toBeLessThanOrEqual(pass.viewportHeight - 24);
    }
  }
});

test("final HMIS chemical card stays fully in frame on a short laptop", async ({ page }) => {
  // Regression: on shorter viewports the faded category band still reserved
  // column height, pushing the last chemical card (Chlorinated solvents) past
  // the stage bottom where overflow:hidden clipped it. Cover the final beats.
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const passes = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="3"]');
    const pauses = [0.58, 0.62, 0.72, 0.78];
    const results = [];
    for (const pause of pauses) {
      window.scrollTo(0, act.offsetTop + act.offsetHeight * pause);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const visibleCards = [...act.querySelectorAll(".hmis-chemical")]
        .map((card) => {
          const box = card.getBoundingClientRect();
          return {
            name: card.querySelector("strong")?.textContent || "",
            opacity: Number(getComputedStyle(card).opacity),
            top: box.top,
            bottom: box.bottom,
          };
        })
        .filter((card) => card.opacity > 0.25);
      results.push({ pause, visibleCards, viewportHeight: window.innerHeight });
    }
    return results;
  });

  for (const pass of passes) {
    expect(pass.visibleCards.length, JSON.stringify(pass)).toBeGreaterThan(0);
    for (const card of pass.visibleCards) {
      expect(card.top, JSON.stringify(pass)).toBeGreaterThanOrEqual(0);
      expect(card.bottom, JSON.stringify(pass)).toBeLessThanOrEqual(pass.viewportHeight - 16);
    }
  }
});

test("HMIS category and warning cards stay inside viewport on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const layout = await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.52);
    const cards = [...document.querySelectorAll('.story .act[data-act="3"] .hmis-category, .story .act[data-act="3"] .hmis-chemical')]
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
  expect(layout.cards).toHaveLength(7);
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(card.width).toBeGreaterThan(180);
  }
});

test("conventional cleaner scene is no longer rendered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".act-chems")).toHaveCount(0);
  await expect(page.locator(".story .act")).toHaveCount(4);
  await expect(page.locator(".story .rail-btn")).toHaveCount(4);
  await expect(page.locator('.story .act[data-act="4"].act-savior')).toHaveCount(1);
});
