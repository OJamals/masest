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

test("story renders five acts with the cost bridge and savior last", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".act-chems")).toHaveCount(0);
  await expect(page.locator(".story .act")).toHaveCount(5);
  await expect(page.locator(".story .rail-btn")).toHaveCount(5);
  await expect(page.locator('.story .act[data-act="4"].act-cost')).toHaveCount(1);
  await expect(page.locator('.story .act[data-act="5"].act-savior')).toHaveCount(1);
});

test("cost act has four legacy lines, a sourced incident total, and a VertKleen column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator('.act-cost .cost-line')).toHaveCount(4);
  await expect(page.locator('.act-cost .cost-incident')).toHaveCount(1);
  await expect(page.locator('.act-cost .cost-vert')).toHaveCount(1);
  await expect(page.locator('.act-cost .cost-sources')).toHaveCount(1);
  await expect(page.locator('.act-cost .cost-num')).toHaveAttribute("data-target", "115000");
});

test("cost columns sit side by side on desktop and stack on mobile", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = await page.evaluate(() => {
    const l = document.querySelector('.act-cost .cost-legacy').getBoundingClientRect();
    const v = document.querySelector('.act-cost .cost-vert').getBoundingClientRect();
    return { sameRow: Math.abs(l.top - v.top) < 24, legacyLeftOfVert: l.right <= v.left + 1 };
  });
  expect(desktop.sameRow).toBe(true);
  expect(desktop.legacyLeftOfVert).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const l = document.querySelector('.act-cost .cost-legacy').getBoundingClientRect();
    const v = document.querySelector('.act-cost .cost-vert').getBoundingClientRect();
    return { stacked: v.top >= l.bottom - 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(mobile.stacked).toBe(true);
  expect(mobile.overflowX).toBe(0);
});

test("cost headline does not overlap the columns", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 768 }]) {
    await page.setViewportSize(vp);
    const r = await page.evaluate(async () => {
      const act = document.querySelector('.story .act[data-act="4"]');
      window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.5);
      await new Promise((z) => setTimeout(z, 500));
      const h = act.querySelector('.act-h').getBoundingClientRect();
      const rig = act.querySelector('.cost-rig').getBoundingClientRect();
      return { headlineBottom: h.bottom, rigTop: rig.top };
    });
    expect(r.rigTop, JSON.stringify({ vp, r })).toBeGreaterThanOrEqual(r.headlineBottom - 1);
  }
});

test("cost scene fits a short laptop with the rig in frame", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const frame = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="4"]');
    // measure during the pinned phase (all beats revealed, stage held in frame)
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.5);
    await new Promise((r) => setTimeout(r, 700));
    const rig = act.querySelector('.cost-rig').getBoundingClientRect();
    return { rigTop: rig.top, rigBottom: rig.bottom, vh: window.innerHeight };
  });
  expect(frame.rigTop).toBeGreaterThanOrEqual(0);
  expect(frame.rigBottom).toBeLessThanOrEqual(frame.vh);
});

test("legacy cost meter counts up to the incident figure by the final beat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const read = async (frac) => page.evaluate(async (f) => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * f);
    await new Promise((r) => setTimeout(r, 800));
    return Number(document.querySelector('.cost-num').textContent.replace(/[,\s]/g, ""));
  }, frac);

  const early = await read(0.3);   // before the incident beat — meter still low
  const end = await read(0.9);      // held at the incident figure
  expect(early).toBeLessThan(115000);
  expect(end).toBe(115000);
});

test("reduced motion story fallback stacks animated scene content without overlap", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const layout = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlap = (a, b) => {
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return x * y;
    };
    const story = document.querySelector(".story");
    const act2Copy = box(document.querySelector('.story .act[data-act="2"] .act-copy'));
    const act2Pipe = box(document.querySelector('.story .act[data-act="2"] .pipe-diagram'));
    const chemicals = [...document.querySelectorAll('.story .act[data-act="3"] .hmis-chemical')]
      .map((card) => ({ name: card.querySelector("strong")?.textContent || card.className, box: box(card) }))
      .filter((card) => card.box && card.box.width > 1 && card.box.height > 1);
    const hmisOverlaps = [];
    for (let i = 0; i < chemicals.length; i += 1) {
      for (let j = i + 1; j < chemicals.length; j += 1) {
        if (overlap(chemicals[i].box, chemicals[j].box) > 4) hmisOverlaps.push(`${chemicals[i].name} / ${chemicals[j].name}`);
      }
    }
    return {
      fallbackActive: !story.classList.contains("story-ready"),
      act2Gap: act2Copy && act2Pipe ? Math.round(act2Pipe.top - act2Copy.bottom) : null,
      hmisOverlaps,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.fallbackActive).toBe(true);
  expect(layout.overflowX).toBe(0);
  expect(layout.act2Gap).toBeGreaterThanOrEqual(12);
  expect(layout.hmisOverlaps).toEqual([]);

  await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop);
  });
  await page.waitForTimeout(300);

  const act3Viewport = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.story .act[data-act="3"] .hmis-category, .story .act[data-act="3"] .hmis-chemical')]
      .map((card) => {
        const r = card.getBoundingClientRect();
        return {
          label: card.textContent.trim().replace(/\s+/g, " ").slice(0, 36),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          visible: r.bottom > 0 && r.top < window.innerHeight,
          cutByViewport: r.top < window.innerHeight && r.bottom > window.innerHeight,
        };
      });
    return {
      viewportHeight: window.innerHeight,
      cutRows: cards.filter((card) => card.cutByViewport),
    };
  });

  expect(act3Viewport.cutRows, JSON.stringify(act3Viewport)).toEqual([]);
});
