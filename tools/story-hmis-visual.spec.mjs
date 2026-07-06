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

test("desktop story handoff keeps visible content between Act 1 and Act 2", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  for (const y of [1000, 1200, 1600, 2000]) {
    await page.evaluate((targetY) => window.scrollTo(0, targetY), y);
    await page.waitForTimeout(900);

    const visibleContent = await page.evaluate(() => [
      ...document.querySelectorAll("#story [data-at], #story .reel-slide, #story .pipe-diagram"),
    ]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
          visible: rect.width > 20
            && rect.height > 20
            && rect.bottom > 120
            && rect.top < window.innerHeight - 80
            && style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity) > 0.15,
        };
      })
      .filter((item) => item.visible));

    expect(visibleContent.length, `blank story handoff at scrollY ${y}`).toBeGreaterThan(0);
  }
});

test("mobile pipe labels match callout colors and fit their chips", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  const labels = await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="2"]');
    act.scrollIntoView({ block: "center" });
    const mobile = [...act.querySelectorAll(".pipe-mobile-labels span")];
    const callouts = [...act.querySelectorAll(".pipe-callout .chip")];
    return mobile.map((label, index) => {
      const dot = label.querySelector("i");
      const calloutDot = callouts[index]?.querySelector("i");
      return {
        text: label.textContent.trim(),
        labelColor: getComputedStyle(dot).backgroundColor,
        calloutColor: calloutDot ? getComputedStyle(calloutDot).backgroundColor : null,
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
      };
    });
  });

  expect(labels).toHaveLength(4);
  for (const label of labels) {
    expect(label.labelColor, JSON.stringify(labels)).toBe(label.calloutColor);
    expect(label.scrollWidth, JSON.stringify(labels)).toBeLessThanOrEqual(label.clientWidth);
  }
});

test("pipe callout chips and leader lines fade from the same burn state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const fades = await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="2"]');
    return [...act.querySelectorAll(".pipe-callout")].map((callout, index) => {
      const burn = (index + 1) / 4;
      callout.style.setProperty("--burn", String(burn));
      callout.style.opacity = "1";
      const chip = callout.querySelector(".chip");
      const line = callout.querySelector("line");
      return {
        text: chip.textContent.trim(),
        burn,
        chipOpacity: Number(getComputedStyle(chip).opacity),
        lineOpacity: Number(getComputedStyle(line).opacity),
      };
    });
  });

  expect(fades).toHaveLength(4);
  for (const fade of fades) {
    expect(fade.chipOpacity, JSON.stringify(fades)).toBeCloseTo(fade.lineOpacity, 2);
    expect(fade.chipOpacity, JSON.stringify(fades)).toBeCloseTo(fade.burn, 2);
  }
});

test("hazard ledger sits below the copy and accumulates all four rows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  await expect(page.locator('.story .act[data-act="3"] .hazard-ledger .ledger-row')).toHaveCount(4);
  await expect(page.locator(".savior-zero-scale .zero-axis")).toHaveCount(3);

  const layout = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.72);
    await new Promise((r) => setTimeout(r, 700));
    const copy = act.querySelector(".act-copy.top").getBoundingClientRect();
    const ledger = act.querySelector(".hazard-ledger").getBoundingClientRect();
    const rows = [...act.querySelectorAll(".ledger-row")].map((row) => {
      const box = row.getBoundingClientRect();
      return {
        name: row.querySelector("strong")?.textContent || "",
        opacity: Number(getComputedStyle(row).opacity),
        top: box.top,
        bottom: box.bottom,
      };
    });
    return { copyBottom: copy.bottom, ledgerTop: ledger.top, rows, viewportHeight: window.innerHeight };
  });

  expect(layout.ledgerTop - layout.copyBottom).toBeGreaterThanOrEqual(12);
  // all four rows have landed by the incident beat and stay stacked in frame
  for (const row of layout.rows) {
    expect(row.opacity, JSON.stringify(layout.rows)).toBeGreaterThan(0.6);
    expect(row.top, JSON.stringify(row)).toBeGreaterThanOrEqual(0);
    expect(row.bottom, JSON.stringify(row)).toBeLessThanOrEqual(layout.viewportHeight);
  }
});

test("full conventional ledger and injury total fit a short laptop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const frame = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.78);
    await new Promise((r) => setTimeout(r, 700));
    const ledger = act.querySelector(".hazard-ledger").getBoundingClientRect();
    const incident = act.querySelector(".ledger-incident").getBoundingClientRect();
    return { ledgerTop: ledger.top, ledgerBottom: ledger.bottom, incidentBottom: incident.bottom, vh: window.innerHeight };
  });
  expect(frame.ledgerTop).toBeGreaterThanOrEqual(0);
  expect(frame.ledgerBottom).toBeLessThanOrEqual(frame.vh);
  expect(frame.incidentBottom).toBeLessThanOrEqual(frame.vh);
});

test("hazard ledger rows stay inside the viewport on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const layout = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".hazard-ledger .ledger-row")].map((row) => {
      const box = row.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    return {
      viewportWidth: window.innerWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows,
    };
  });

  expect(layout.overflowX).toBe(0);
  expect(layout.rows).toHaveLength(8);
  for (const row of layout.rows) {
    expect(row.left).toBeGreaterThanOrEqual(0);
    expect(row.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(row.width).toBeGreaterThan(180);
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

test("mirror ledgers share one skeleton: conventional bill, then VertKleen zeros", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator('.act-hmis .hazard-ledger .ledger-row')).toHaveCount(4);
  await expect(page.locator('.act-cost .hazard-ledger.ledger-zero .ledger-row')).toHaveCount(4);
  await expect(page.locator('.act-hmis .cost-num')).toHaveAttribute("data-target", "115000");
  await expect(page.locator('.act-cost .cost-payoff')).toHaveCount(1);

  const zeros = await page.evaluate(() =>
    [...document.querySelectorAll(".act-cost .hmis-score.score-zero")]
      .map((score) => score.textContent.trim()));
  expect(zeros).toEqual(["000", "000", "000", "000"]);
});

test("act four headline does not overlap its ledger", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 768 }]) {
    await page.setViewportSize(vp);
    const r = await page.evaluate(async () => {
      const act = document.querySelector('.story .act[data-act="4"]');
      window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.5);
      await new Promise((z) => setTimeout(z, 500));
      const h = act.querySelector(".act-h").getBoundingClientRect();
      const ledger = act.querySelector(".hazard-ledger").getBoundingClientRect();
      return { headlineBottom: h.bottom, ledgerTop: ledger.top };
    });
    expect(r.ledgerTop, JSON.stringify({ vp, r })).toBeGreaterThanOrEqual(r.headlineBottom - 1);
  }
});

test("act four ledger fits a short laptop in frame", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const frame = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.7);
    await new Promise((r) => setTimeout(r, 700));
    const ledger = act.querySelector(".hazard-ledger").getBoundingClientRect();
    return { ledgerTop: ledger.top, ledgerBottom: ledger.bottom, vh: window.innerHeight };
  });
  expect(frame.ledgerTop).toBeGreaterThanOrEqual(0);
  expect(frame.ledgerBottom).toBeLessThanOrEqual(frame.vh);
});

test("injury total counts up inside scene three by the incident beat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const read = async (frac) => page.evaluate(async (f) => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * f);
    await new Promise((r) => setTimeout(r, 800));
    return Number(document.querySelector(".act-hmis .cost-num").textContent.replace(/[,\s]/g, ""));
  }, frac);

  const early = await read(0.3);   // before the incident beat - meter still low
  const end = await read(0.9);      // held at the incident figure
  expect(early).toBeLessThan(115000);
  expect(end).toBe(115000);
});

test("act four rows do not ghost in before their beats", async ({ page }) => {
  // Regression: the old split screen pre-revealed the VertKleen column at 42%
  // opacity from the first frame, spoiling the reveal and reading as a glitch.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const opacities = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + 8);
    await new Promise((r) => setTimeout(r, 700));
    return [...act.querySelectorAll(".ledger-row")].map((row) => Number(getComputedStyle(row).opacity));
  });
  for (const opacity of opacities) expect(opacity, JSON.stringify(opacities)).toBeLessThan(0.2);
});

test("scene handoff keeps the incoming stage visible - no black gap", async ({ page }) => {
  // Regression: only the current act's stage was visible, so the slide zone
  // between acts showed a full viewport of black before the next scene popped in.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const handoff = await page.evaluate(async () => {
    const act3 = document.querySelector('.story .act[data-act="3"]');
    const act4 = document.querySelector('.story .act[data-act="4"]');
    // park mid-slide: act 3 unpinned, act 4 sliding up but not yet current
    const y = act3.offsetTop + act3.offsetHeight - window.innerHeight * 0.6;
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 700));
    const s3 = getComputedStyle(act3.querySelector(".stage"));
    const s4 = getComputedStyle(act4.querySelector(".stage"));
    return {
      out: { visibility: s3.visibility, opacity: Number(s3.opacity) },
      inc: { visibility: s4.visibility, opacity: Number(s4.opacity) },
    };
  });
  expect(handoff.inc.visibility, JSON.stringify(handoff)).toBe("visible");
  expect(handoff.inc.opacity, JSON.stringify(handoff)).toBeGreaterThan(0.9);
});

test("savior scene holds readable proof cards and CTAs in the payoff window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const payoff = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="5"]');
    const samples = [];
    for (const frac of [0.62, 0.85]) {
      window.scrollTo(0, act.offsetTop + (act.offsetHeight - window.innerHeight) * frac);
      await new Promise((r) => setTimeout(r, 700));
      const cards = [...act.querySelectorAll(".zero-axis")].map((card) => {
        const box = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        return {
          text: card.textContent.trim().replace(/\s+/g, " "),
          opacity: Number(style.opacity),
          top: box.top,
          bottom: box.bottom,
          width: box.width,
        };
      });
      const ctas = [...act.querySelectorAll(".savior-ctas .btn")].map((btn) => {
        const box = btn.getBoundingClientRect();
        const style = getComputedStyle(btn);
        return {
          text: btn.textContent.trim(),
          opacity: Number(style.opacity),
          visible: style.visibility !== "hidden" && box.width > 80 && box.height > 32,
          top: box.top,
          bottom: box.bottom,
        };
      });
      samples.push({ frac, cards, ctas });
    }
    return { samples, viewportHeight: window.innerHeight };
  });

  for (const sample of payoff.samples) {
    expect(sample.cards).toHaveLength(3);
    for (const card of sample.cards) {
      expect(card.opacity, JSON.stringify(payoff)).toBeGreaterThanOrEqual(0.72);
      expect(card.width, JSON.stringify(payoff)).toBeGreaterThan(150);
      expect(card.top, JSON.stringify(payoff)).toBeGreaterThanOrEqual(0);
      expect(card.bottom, JSON.stringify(payoff)).toBeLessThanOrEqual(payoff.viewportHeight);
    }
    expect(sample.ctas).toHaveLength(2);
    for (const cta of sample.ctas) {
      expect(cta.visible, JSON.stringify(payoff)).toBe(true);
      expect(cta.opacity, JSON.stringify(payoff)).toBeGreaterThanOrEqual(0.72);
      expect(cta.bottom, JSON.stringify(payoff)).toBeLessThanOrEqual(payoff.viewportHeight);
    }
  }
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
    const chemicals = [...document.querySelectorAll('.story .act[data-act="3"] .ledger-row')]
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
    const cards = [...document.querySelectorAll('.story .act[data-act="3"] .ledger-row, .story .act[data-act="3"] .ledger-incident')]
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
