import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

test.use({ channel: "chrome" });

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

test("four-act story meets measured desktop and mobile height budgets", async ({ page }) => {
  const measure = () => page.evaluate(() => {
    const story = document.querySelector(".story");
    return {
      acts: story.querySelectorAll(":scope > .act").length,
      railStops: story.querySelectorAll(".rail-btn").length,
      ready: story.classList.contains("story-ready"),
      height: story.offsetHeight,
      viewportHeight: window.innerHeight,
      viewports: story.offsetHeight / window.innerHeight,
    };
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  const desktop = await measure();
  expect(desktop.acts).toBe(4);
  expect(desktop.railStops).toBe(4);
  expect(desktop.ready).toBe(true);
  expect(desktop.viewports, JSON.stringify(desktop)).toBeGreaterThanOrEqual(6);
  expect(desktop.viewports, JSON.stringify(desktop)).toBeLessThanOrEqual(7);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  const mobile = await measure();
  expect(mobile.acts).toBe(4);
  expect(mobile.ready).toBe(false);
  expect(mobile.viewports, JSON.stringify(mobile)).toBeLessThanOrEqual(6.5);
});

test("operational Replacement Ledger and qualifications fit the desktop frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  const layout = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight - window.innerHeight - 50);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const box = (selector) => {
      const rect = act.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    return {
      table: box(".replacement-ledger"),
      qualification: box(".ledger-qualification"),
      sources: box(".cost-sources"),
      rows: act.querySelectorAll(".replacement-ledger tbody tr").length,
      safeRatings: [...act.querySelectorAll(".hmis-chip.is-safe")]
        .map((node) => node.textContent.trim().replaceAll("\u2011", "-")),
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.rows).toBe(4);
  expect(layout.safeRatings).toEqual(["0-0-0", "0-0-0", "0-0-0", "0-0-0"]);
  for (const item of [layout.table, layout.qualification, layout.sources]) {
    expect(item.top, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
    expect(item.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportHeight);
  }
});

test("mobile ledger owns horizontal overflow and remains keyboard scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });

  const region = page.locator(".replacement-ledger-scroll");
  await region.scrollIntoViewIfNeeded();
  const before = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(before.pageOverflow).toBe(0);
  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);

  await region.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("asymmetric proof close keeps the dominant CTA clear of chat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  const close = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight - window.innerHeight - 30);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const proof = act.querySelector(".proof-panel").getBoundingClientRect();
    const action = act.querySelector(".close-action").getBoundingClientRect();
    return {
      proofWidth: proof.width,
      actionWidth: action.width,
      zeroAxes: act.querySelectorAll(".zero-axis").length,
      ctas: act.querySelectorAll(".proof-close .btn").length,
    };
  });
  expect(Math.abs(close.proofWidth - close.actionWidth), JSON.stringify(close)).toBeGreaterThan(80);
  expect(close.zeroAxes).toBe(0);
  expect(close.ctas).toBe(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  const collision = await page.evaluate(() => {
    const cta = document.querySelector('.story .act[data-act="1"] .btn-primary');
    const chat = document.querySelector(".customer-chat__toggle");
    const a = cta.getBoundingClientRect();
    const b = chat.getBoundingClientRect();
    return {
      href: cta.getAttribute("href"),
      ctaBottom: a.bottom,
      viewportHeight: window.innerHeight,
      overlaps: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    };
  });
  expect(collision.href).toBe("products#catalog");
  expect(collision.ctaBottom).toBeLessThanOrEqual(collision.viewportHeight);
  expect(collision.overlaps, JSON.stringify(collision)).toBe(false);
});

test("injury and savings proof counters reach their sourced totals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  const readAtEnd = async (actNumber) => page.evaluate(async (number) => {
    const act = document.querySelector('.story .act[data-act="' + number + '"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight - window.innerHeight - 30);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const counter = act.querySelector(".cost-num");
    return {
      target: Number(counter.dataset.target),
      value: Number(counter.textContent.replace(/[,\s]/g, "")),
    };
  }, actNumber);

  expect(await readAtEnd(3)).toEqual({ target: 115000, value: 115000 });
  expect(await readAtEnd(4)).toEqual({ target: 10000, value: 10000 });
});

test("rail and chat release before light content in both scroll directions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  const sample = async (direction) => {
    const positions = await page.evaluate(() => {
      const story = document.querySelector(".story");
      const bottom = story.offsetTop + story.offsetHeight;
      return { before: bottom - window.innerHeight - 100, target: bottom - window.innerHeight + 120, after: bottom + 300 };
    });
    await page.evaluate((y) => window.scrollTo(0, y), direction === "forward" ? positions.before : positions.after);
    await page.waitForTimeout(120);
    await page.evaluate((y) => window.scrollTo(0, y), positions.target);
    await page.waitForTimeout(350);
    return page.evaluate(() => {
      const rail = document.querySelector(".story-rail");
      const light = document.querySelector(".trust-strip").getBoundingClientRect();
      const style = getComputedStyle(rail);
      return {
        storyInView: document.body.classList.contains("story-in-view"),
        railOpacity: Number(style.opacity),
        railVisibility: style.visibility,
        lightTop: light.top,
        viewportHeight: window.innerHeight,
        chatUsesStoryTheme: document.querySelector(".customer-chat").classList.contains("customer-chat--story"),
      };
    });
  };

  for (const direction of ["forward", "reverse"]) {
    const state = await sample(direction);
    expect(state.storyInView, JSON.stringify({ direction, state })).toBe(false);
    expect(state.railOpacity, JSON.stringify({ direction, state })).toBeLessThanOrEqual(0.05);
    expect(state.railVisibility, JSON.stringify({ direction, state })).toBe("hidden");
    expect(state.lightTop).toBeGreaterThan(0);
    expect(state.lightTop).toBeLessThan(state.viewportHeight);
    expect(state.chatUsesStoryTheme).toBe(false);
  }
});

test("focus treatment and primary CTA contrast remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });

  const initial = await page.evaluate(() => ({
    primaryTabIndex: document.querySelector('.story .act[data-act="1"] .btn-primary').tabIndex,
    ledgerLinkTabIndex: document.querySelector('.story .act[data-act="3"] a').tabIndex,
  }));
  expect(initial.primaryTabIndex).toBe(0);
  expect(initial.ledgerLinkTabIndex).toBe(-1);

  const region = page.locator(".replacement-ledger-scroll");
  await page.evaluate(() => {
    const act = document.querySelector('.story .act[data-act="3"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight - window.innerHeight - 50);
  });
  await page.waitForTimeout(500);
  await region.focus();
  const focus = await region.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      active: document.activeElement === element,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
    };
  });
  expect(focus.active).toBe(true);
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);

  const contrast = await page.locator('.story .act[data-act="1"] .btn-primary').evaluate((element) => {
    const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (rgb) => rgb
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("missing GSAP falls back to the complete static four-act story", async ({ page }) => {
  await page.route("**/vendor/gsap/**", (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  const fallback = await page.evaluate(() => {
    const story = document.querySelector(".story");
    return {
      ready: story.classList.contains("story-ready"),
      acts: [...story.querySelectorAll(":scope > .act")].map((act) => ({
        display: getComputedStyle(act).display,
        textLength: act.innerText.trim().length,
      })),
      href: story.querySelector('.act[data-act="1"] .btn-primary').getAttribute("href"),
    };
  });
  expect(fallback.ready).toBe(false);
  expect(fallback.acts).toHaveLength(4);
  expect(fallback.href).toBe("products#catalog");
  for (const act of fallback.acts) {
    expect(act.display).not.toBe("none");
    expect(act.textLength).toBeGreaterThan(100);
  }
});

test("no-JS mode exposes the same complete accessible story", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL + "/index.html", { waitUntil: "networkidle" });
    const staticStory = await page.evaluate(() => {
      const story = document.querySelector(".story");
      return {
        acts: [...story.querySelectorAll(":scope > .act")].map((act) => ({
          heading: act.querySelector("h1, h2, h3")?.textContent.trim(),
          display: getComputedStyle(act).display,
          visibility: getComputedStyle(act).visibility,
        })),
        href: story.querySelector('.act[data-act="1"] .btn-primary').getAttribute("href"),
        ready: story.classList.contains("story-ready"),
        viewports: story.offsetHeight / window.innerHeight,
      };
    });
    expect(staticStory.ready).toBe(false);
    expect(staticStory.acts).toHaveLength(4);
    expect(staticStory.href).toBe("products#catalog");
    expect(staticStory.viewports).toBeLessThanOrEqual(6.5);
    for (const act of staticStory.acts) {
      expect(act.heading).toBeTruthy();
      expect(act.display).not.toBe("none");
      expect(act.visibility).toBe("visible");
    }
  } finally {
    await context.close();
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

test("reduced motion disables meaningful global and blog movement while keeping CTAs visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  const cta = page.locator(".btn.btn-primary").first();
  await expect(cta).toBeVisible();
  await cta.hover();
  expect(await cta.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  })).toEqual({
    animationDuration: "0s",
    transform: "none",
    transitionDuration: "0s",
  });

  await page.goto(`${BASE_URL}/blog.html`, { waitUntil: "networkidle" });
  const blogCard = page.locator(".blog-card").first();
  await expect(blogCard).toBeVisible();
  await blogCard.hover();
  expect(await blogCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      boxShadow: style.boxShadow,
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  })).toEqual({
    animationDuration: "0s",
    boxShadow: "none",
    transform: "none",
    transitionDuration: "0s",
  });
});
