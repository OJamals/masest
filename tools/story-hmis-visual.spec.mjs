import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

const PORT = 4194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${BASE_URL}/index.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(() => {
  if (!server) return;
  server.kill();
  server.unref();
  server = null;
});

async function openStory(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    const storyCritical = /\/(?:css\/story\.css|js\/story\.js|vendor\/gsap\/|img\/blog\/cases\/hcr-brevard-|img\/updates\/vertkleen-hvac-hcr-5gal)/.test(path);
    if (storyCritical && response.status() >= 400) {
      errors.push(`response ${response.status()}: ${response.url()}`);
    }
  });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(250);
  return errors;
}

async function scrollAct(page, actNumber, progress = .5) {
  await page.locator(`.story .act[data-act="${actNumber}"]`).evaluate((act, fraction) => {
    const story = document.getElementById("story");
    const road = Math.max(0, act.offsetHeight - window.innerHeight);
    window.scrollTo(0, story.offsetTop + act.offsetTop + road * fraction);
  }, progress);
  await page.waitForTimeout(500);
}

test("story boots cleanly with one verified visual object and four scene renderers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openStory(page);

  const state = await page.evaluate(() => {
    const story = document.getElementById("story");
    const images = [...story.querySelectorAll(".story-object img")];
    return {
      ready: story.classList.contains("story-ready"),
      acts: [...story.querySelectorAll(":scope > .act")].map((act) => act.dataset.scene),
      objects: story.querySelectorAll(":scope > .story-object").length,
      rendererScenes: window.__MASESTStory?.scenes,
      images: images.map((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        source: new URL(image.currentSrc || image.src).pathname,
      })),
    };
  });

  expect(errors).toEqual([]);
  expect(state.ready).toBe(true);
  expect(state.acts).toEqual(["diagnose", "burden", "switch", "prove"]);
  expect(state.objects).toBe(1);
  expect(state.rendererScenes).toEqual(state.acts);
  expect(state.images).toHaveLength(3);
  for (const image of state.images) {
    expect(image.complete, JSON.stringify(state.images)).toBe(true);
    expect(image.naturalWidth, JSON.stringify(state.images)).toBeGreaterThan(500);
  }
});

test("desktop story uses a compact 4.2-to-4.8 viewport scroll road", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const geometry = await page.evaluate(() => {
    const story = document.getElementById("story");
    return {
      viewports: story.offsetHeight / window.innerHeight,
      actViewports: [...story.querySelectorAll(":scope > .act")]
        .map((act) => act.offsetHeight / window.innerHeight),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(geometry.viewports, JSON.stringify(geometry)).toBeGreaterThanOrEqual(4.2);
  expect(geometry.viewports, JSON.stringify(geometry)).toBeLessThanOrEqual(4.81);
  expect(geometry.actViewports).toEqual([1.25, 1.2, 1.15, 1.2]);
  expect(geometry.pageOverflow).toBe(0);
});

test("same story object remains pinned while scene state and chapter navigation advance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const samples = [];
  for (const [act, progress] of [[1, .58], [2, .58], [3, .62], [4, .94]]) {
    await scrollAct(page, act, progress);
    samples.push(await page.evaluate(() => {
      const story = document.getElementById("story");
      const object = story.querySelector(".story-object");
      const box = object.getBoundingClientRect();
      const after = story.querySelector(".story-object__after");
      const product = story.querySelector(".story-object__product");
      return {
        scene: story.dataset.activeScene,
        current: story.querySelector('.rail-btn[aria-current="step"]')?.textContent.trim(),
        objectConnected: object.isConnected,
        objectTop: Math.round(box.top),
        objectWidth: Math.round(box.width),
        reveal: Number(getComputedStyle(after).opacity) * 100,
        product: Number(getComputedStyle(product).opacity),
        status: story.querySelector(".story-object__status")?.textContent.trim(),
      };
    }));
  }

  expect(samples.map((sample) => sample.scene)).toEqual(["diagnose", "burden", "switch", "prove"]);
  expect(samples.map((sample) => sample.current)).toEqual(["01Diagnose", "02Burden", "03Switch", "04Prove"]);
  expect(samples.every((sample) => sample.objectConnected)).toBe(true);
  expect(new Set(samples.map((sample) => sample.objectTop)).size).toBe(1);
  expect(new Set(samples.map((sample) => sample.objectWidth)).size).toBe(1);
  expect(samples[0].reveal).toBe(0);
  expect(samples[1].reveal).toBe(0);
  expect(samples[2].reveal).toBeGreaterThan(5);
  expect(samples[2].product).toBeGreaterThan(.5);
  expect(samples[3].reveal).toBeGreaterThan(85);
  expect(samples[3].product).toBe(1);
  expect(samples[3].status).toBe("Result");
});

test("desktop chapter rail keeps connector lines clear of unclipped labels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const geometry = await page.locator('.rail-btn[aria-current="step"]').evaluate((button) => {
    const label = button.querySelector("span");
    const buttonStyle = getComputedStyle(button);
    const labelStyle = getComputedStyle(label);
    const connectorStyle = getComputedStyle(button, "::before");
    const transform = new DOMMatrixReadOnly(connectorStyle.transform);
    const connectorLeft = Number.parseFloat(connectorStyle.left) + transform.e;
    const connectorRight = connectorLeft + Number.parseFloat(connectorStyle.width) * transform.a;

    return {
      buttonPosition: buttonStyle.position,
      connectorRight,
      labelLeft: label.offsetLeft,
      labelOverflow: labelStyle.overflow,
      lineHeightRatio: Number.parseFloat(labelStyle.lineHeight) / Number.parseFloat(labelStyle.fontSize),
    };
  });

  expect(geometry.buttonPosition, JSON.stringify(geometry)).toBe("relative");
  expect(geometry.connectorRight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.labelLeft - 3);
  expect(geometry.labelOverflow, JSON.stringify(geometry)).toBe("visible");
  expect(geometry.lineHeightRatio, JSON.stringify(geometry)).toBeGreaterThanOrEqual(1.2);
});

test("desktop chapter rail clears the active copy column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  for (let act = 1; act <= 4; act += 1) {
    await scrollAct(page, act, .52);
    const spacing = await page.evaluate(() => {
      const active = document.querySelector('.rail-btn[aria-current="step"] span')
        .getBoundingClientRect();
      const copy = document.querySelector(
        `.act[data-scene="${document.getElementById("story").dataset.activeScene}"] .act-content`
      ).getBoundingClientRect();
      return { railRight: active.right, copyLeft: copy.left };
    });
    expect(spacing.railRight, JSON.stringify(spacing)).toBeLessThanOrEqual(spacing.copyLeft - 16);
  }
});

test("desktop chapter handoffs never leave a blank viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const result = await page.evaluate(async () => {
    const story = document.getElementById("story");
    const start = story.offsetTop;
    const end = start + story.offsetHeight - innerHeight;
    const blanks = [];
    for (let step = 0; step <= 16; step += 1) {
      const y = start + (end - start) * (step / 16);
      scrollTo(0, y);
      window.ScrollTrigger.update();
      await new Promise((resolve) => setTimeout(resolve, 70));
      const visibleCopy = [...story.querySelectorAll(".act-content")].some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.bottom > 90
          && rect.top < innerHeight - 60
          && style.visibility !== "hidden"
          && Number(style.opacity) > .08;
      });
      const object = story.querySelector(".story-object__card").getBoundingClientRect();
      if (!visibleCopy || object.bottom <= 60 || object.top >= innerHeight) {
        blanks.push({ step, y, visibleCopy, objectTop: object.top, objectBottom: object.bottom });
      }
    }
    return blanks;
  });

  expect(result).toEqual([]);
});

test("persistent product actions remain visible and correctly routed in every scene", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  for (let act = 1; act <= 4; act += 1) {
    await scrollAct(page, act, .52);
    const action = await page.locator(".story-actions").evaluate((nav) => {
      const box = nav.getBoundingClientRect();
      const shop = nav.querySelector(".story-actions__shop");
      const trial = nav.querySelector(".story-actions__trial");
      return {
        top: box.top,
        bottom: box.bottom,
        visible: getComputedStyle(nav).visibility,
        shop: shop.getAttribute("href"),
        trial: trial.getAttribute("href"),
      };
    });
    expect(action.top).toBeGreaterThanOrEqual(58);
    expect(action.bottom).toBeLessThanOrEqual(112);
    expect(action.visible).toBe("visible");
    expect(action.shop).toBe("products/hcr");
    expect(action.trial).toContain("product=VertKleen%20HCR");
  }
});

for (const width of [320, 390, 430]) {
  test(`compact story fits ${width}px without clipping or horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await openStory(page);

    const layout = await page.evaluate(() => {
      const story = document.getElementById("story");
      const viewportWidth = document.documentElement.clientWidth;
      const boxes = [
        story.querySelector(".story-actions"),
        story.querySelector(".story-object__card"),
        ...story.querySelectorAll(".act-content"),
        story.querySelector(".proof-stats"),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      return {
        ready: story.classList.contains("story-ready"),
        mobileReady: story.classList.contains("story-mobile-ready"),
        overflow: document.documentElement.scrollWidth - viewportWidth,
        viewportWidth,
        boxes,
      };
    });

    expect(errors).toEqual([]);
    expect(layout.ready).toBe(false);
    expect(layout.mobileReady).toBe(true);
    expect(layout.overflow).toBe(0);
    for (const box of layout.boxes) {
      expect(box.left, JSON.stringify(layout)).toBeGreaterThanOrEqual(-1);
      expect(box.right, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportWidth + 1);
    }
  });
}

test("compact native-scroll chapters reveal in both directions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page);

  const scenes = [];
  for (const act of [1, 2, 3, 4, 2]) {
    await page.locator(`.story .act[data-act="${act}"]`).evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(350);
    scenes.push(await page.evaluate(() => ({
      active: document.getElementById("story").dataset.activeScene,
      visibleActs: [...document.querySelectorAll(".story .act.is-mobile-visible")]
        .map((element) => Number(element.dataset.act)),
    })));
  }

  expect(scenes.map((sample) => sample.active)).toEqual(["diagnose", "burden", "switch", "prove", "burden"]);
  expect(scenes.at(-1).visibleActs).toEqual(expect.arrayContaining([1, 2, 3, 4]));
});

test("mobile cleaner comparison becomes complete conventional-versus-VertKleen cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page);
  await page.locator(".replacement-guide details").evaluate((details) => {
    details.open = true;
    details.scrollIntoView({ block: "start" });
  });

  const ledger = await page.evaluate(() => {
    const table = document.querySelector(".replacement-ledger");
    const rows = [...table.querySelectorAll("tbody tr")];
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableOverflow: table.scrollWidth - table.clientWidth,
      cards: rows.map((row) => {
        const box = row.getBoundingClientRect();
        return {
          width: box.width,
          conventional: row.querySelector('[data-label="Conventional"]')?.innerText.trim(),
          vertkleen: row.querySelector('[data-label="VertKleen"]')?.innerText.trim(),
          conventionalLabel: getComputedStyle(
            row.querySelector('[data-label="Conventional"]'),
            "::before"
          ).content,
          vertkleenLabel: getComputedStyle(
            row.querySelector('[data-label="VertKleen"]'),
            "::before"
          ).content,
        };
      }),
    };
  });

  expect(ledger.pageOverflow).toBe(0);
  expect(ledger.tableOverflow).toBe(0);
  expect(ledger.cards).toHaveLength(4);
  for (const card of ledger.cards) {
    expect(card.width).toBeLessThanOrEqual(362);
    expect(card.conventional).toBeTruthy();
    expect(card.vertkleen).toMatch(/VertKleen/);
    expect(card.conventionalLabel).toBe('"Conventional"');
    expect(card.vertkleenLabel).toBe('"VertKleen"');
  }
});

test("desktop tab order excludes links until their reveal is visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const linkState = (act) => page.locator(`.act[data-act="${act}"] a`).first().evaluate((link) => ({
    opacity: Number(getComputedStyle(link.closest("[data-at]")).opacity),
    tabIndex: link.tabIndex,
  }));

  expect(await linkState(1)).toMatchObject({ opacity: 0, tabIndex: -1 });
  await scrollAct(page, 1, .94);
  expect((await linkState(1)).opacity).toBeGreaterThan(.5);
  expect((await linkState(1)).tabIndex).toBe(0);

  await scrollAct(page, 3, .05);
  expect(await linkState(3)).toMatchObject({ opacity: 0, tabIndex: -1 });
  await scrollAct(page, 3, .94);
  expect((await linkState(3)).opacity).toBeGreaterThan(.5);
  expect((await linkState(3)).tabIndex).toBe(0);
});

test("desktop focusability follows the visible chapter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const initial = await page.evaluate(() => ({
    act1: document.querySelector('.act[data-act="1"] a').tabIndex,
    act3: document.querySelector('.act[data-act="3"] a').tabIndex,
    act3Hidden: document.querySelector('.act[data-act="3"]').getAttribute("aria-hidden"),
  }));
  expect(initial.act1).toBe(-1);
  expect(initial.act3).toBe(-1);
  expect(initial.act3Hidden).toBe("true");

  await scrollAct(page, 3, .94);
  const switched = await page.evaluate(() => ({
    act1: document.querySelector('.act[data-act="1"] a').tabIndex,
    act3: document.querySelector('.act[data-act="3"] a').tabIndex,
    act1Hidden: document.querySelector('.act[data-act="1"]').getAttribute("aria-hidden"),
    act3Hidden: document.querySelector('.act[data-act="3"]').getAttribute("aria-hidden"),
  }));
  expect(switched).toEqual({ act1: -1, act3: 0, act1Hidden: "true", act3Hidden: "false" });
});

test("skip-story control lands on the visible four-step summary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);
  await page.locator(".story-skip").click();
  await page.waitForTimeout(350);

  const landing = await page.locator("#storySummary").evaluate((summary) => {
    const rect = summary.getBoundingClientRect();
    return {
      hash: location.hash,
      top: rect.top,
      bottom: rect.bottom,
      visible: getComputedStyle(summary).visibility,
      steps: summary.querySelectorAll("li").length,
    };
  });
  expect(landing.hash).toBe("#storySummary");
  expect(landing.top).toBeGreaterThanOrEqual(0);
  expect(landing.top).toBeLessThan(100);
  expect(landing.bottom).toBeGreaterThan(landing.top);
  expect(landing.visible).toBe("visible");
  expect(landing.steps).toBe(4);
});

test("missing GSAP exposes complete static content and final proof", async ({ page }) => {
  await page.route("**/vendor/gsap/**", (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openStory(page);

  const fallback = await page.evaluate(() => {
    const story = document.getElementById("story");
    return {
      ready: story.classList.contains("story-ready"),
      mobileReady: story.classList.contains("story-mobile-ready"),
      scene: story.dataset.activeScene,
      reveal: Number(getComputedStyle(story.querySelector(".story-object__after")).opacity) * 100,
      acts: [...story.querySelectorAll(":scope > .act")].map((act) => ({
        ariaHidden: act.getAttribute("aria-hidden"),
        height: act.getBoundingClientRect().height,
        text: act.innerText.trim().length,
      })),
      href: story.querySelector('.act[data-act="1"] .btn-primary').getAttribute("href"),
    };
  });

  expect(errors).toEqual([]);
  expect(fallback.ready).toBe(false);
  expect(fallback.mobileReady).toBe(false);
  expect(fallback.scene).toBe("prove");
  expect(fallback.reveal).toBeGreaterThan(99);
  expect(fallback.href).toBe("products/hcr");
  for (const act of fallback.acts) {
    expect(act.ariaHidden).toBeNull();
    expect(act.height).toBeGreaterThan(200);
    expect(act.text).toBeGreaterThan(100);
  }
});

test("no-JS mode keeps all four chapters and actions readable", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
    const state = await page.evaluate(() => {
      const story = document.getElementById("story");
      return {
        ready: story.classList.contains("story-ready"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        acts: [...story.querySelectorAll(":scope > .act")].map((act) => ({
          heading: act.querySelector("h1, h2")?.textContent.trim(),
          opacity: getComputedStyle(act.querySelector(".act-content")).opacity,
          visibility: getComputedStyle(act.querySelector(".act-content")).visibility,
        })),
        actions: [...story.querySelectorAll('a[href]')].map((link) => link.getAttribute("href")),
      };
    });
    expect(state.ready).toBe(false);
    expect(state.overflow).toBe(0);
    expect(state.acts).toHaveLength(4);
    for (const act of state.acts) {
      expect(act.heading).toBeTruthy();
      expect(act.opacity).toBe("1");
      expect(act.visibility).toBe("visible");
    }
    expect(state.actions).toContain("products/hcr");
    expect(state.actions).toContain("#storySummary");
  } finally {
    await context.close();
  }
});

test("reduced motion produces a complete, non-overlapping static story", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page);

  const layout = await page.evaluate(() => {
    const story = document.getElementById("story");
    const acts = [...story.querySelectorAll(":scope > .act")];
    const boxes = acts.map((act) => {
      const rect = act.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    const content = story.querySelector(".act-content");
    const chat = document.querySelector(".customer-chat__toggle");
    return {
      ready: story.classList.contains("story-ready"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overlap: boxes.slice(1).some((box, index) => box.top < boxes[index].bottom - 1),
      opacity: getComputedStyle(content).opacity,
      transition: getComputedStyle(content).transitionDuration,
      product: getComputedStyle(story.querySelector(".story-object__product")).opacity,
      chatVisibility: chat ? getComputedStyle(chat).visibility : "missing",
    };
  });

  expect(layout.ready).toBe(false);
  expect(layout.overflow).toBe(0);
  expect(layout.overlap).toBe(false);
  expect(layout.opacity).toBe("1");
  expect(layout.transition).toBe("0s");
  expect(layout.product).toBe("1");
  expect(layout.chatVisibility).toBe("hidden");
});

test("reverse scroll restores prior scene state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);
  await scrollAct(page, 4, .9);
  const end = await page.evaluate(() => ({
    scene: document.getElementById("story").dataset.activeScene,
    reveal: Number(getComputedStyle(document.querySelector(".story-object__after")).opacity) * 100,
  }));
  await scrollAct(page, 2, .45);
  const reversed = await page.evaluate(() => ({
    scene: document.getElementById("story").dataset.activeScene,
    reveal: Number(getComputedStyle(document.querySelector(".story-object__after")).opacity) * 100,
  }));

  expect(end.scene).toBe("prove");
  expect(end.reveal).toBeGreaterThan(80);
  expect(reversed.scene).toBe("burden");
  expect(reversed.reveal).toBeLessThan(15);
});

test("720px compact layout covers a 200-percent desktop zoom equivalent", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openStory(page);
  const layout = await page.evaluate(() => {
    const story = document.getElementById("story");
    const action = story.querySelector(".story-actions").getBoundingClientRect();
    const object = story.querySelector(".story-object__card").getBoundingClientRect();
    return {
      compact: story.classList.contains("story-mobile-ready"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      actionRight: action.right,
      objectRight: object.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(layout.compact).toBe(true);
  expect(layout.overflow).toBe(0);
  expect(layout.actionRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.objectRight).toBeLessThanOrEqual(layout.viewportWidth);
});

test("live 200-percent zoom crossing reconfigures the story without hidden chapters", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const storyState = () => page.evaluate(() => {
    const story = document.getElementById("story");
    return {
      ready: story.classList.contains("story-ready"),
      mobileReady: story.classList.contains("story-mobile-ready"),
      hiddenActs: [...story.querySelectorAll(":scope > .act")]
        .filter((act) => act.getAttribute("aria-hidden") === "true").length,
      storyTriggers: window.ScrollTrigger.getAll()
        .filter((trigger) => trigger.trigger?.matches?.(".story .act")).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(await storyState()).toMatchObject({
    ready: true,
    mobileReady: false,
    hiddenActs: 3,
    storyTriggers: 4,
    overflow: 0,
  });

  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(500);
  expect(await storyState()).toMatchObject({
    ready: false,
    mobileReady: true,
    hiddenActs: 0,
    storyTriggers: 0,
    overflow: 0,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  expect(await storyState()).toMatchObject({
    ready: true,
    mobileReady: false,
    hiddenActs: 3,
    storyTriggers: 4,
    overflow: 0,
  });
});

test("desktop story stays inside a controlled-scroll frame budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStory(page);

  const metrics = await page.evaluate(async () => {
    const story = document.getElementById("story");
    const startY = story.offsetTop;
    const endY = startY + story.offsetHeight - innerHeight;
    const idleDeltas = [];
    const deltas = [];
    const longTasks = [];
    let observer = null;

    if ("PerformanceObserver" in window
      && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    }

    await new Promise((resolve) => {
      let startedAt = 0;
      let previous = 0;
      function idleFrame(now) {
        if (!startedAt) {
          startedAt = now;
          previous = now;
        } else {
          idleDeltas.push(now - previous);
          previous = now;
        }
        if (now - startedAt < 2000) requestAnimationFrame(idleFrame);
        else resolve();
      }
      requestAnimationFrame(idleFrame);
    });

    await new Promise((resolve) => {
      let startedAt = 0;
      let previous = 0;
      function frame(now) {
        if (!startedAt) {
          startedAt = now;
          previous = now;
        } else {
          deltas.push(now - previous);
          previous = now;
        }
        const progress = Math.min(1, (now - startedAt) / 7000);
        scrollTo(0, startY + (endY - startY) * progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    observer?.disconnect();

    const sorted = deltas.slice().sort((a, b) => a - b);
    const idleSorted = idleDeltas.slice().sort((a, b) => a - b);
    const percentile = (fraction) => sorted[Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * fraction),
    )];
    const idleAverage = idleDeltas.reduce((sum, value) => sum + value, 0) / idleDeltas.length;
    const idleP95 = idleSorted[Math.min(idleSorted.length - 1, Math.floor(idleSorted.length * .95))];
    const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const p95 = percentile(.95);
    const p99 = percentile(.99);
    return {
      frames: deltas.length,
      frameCoverage: deltas.length / (7000 / idleAverage),
      idleAverage,
      idleP95,
      average,
      p95,
      p95BaselineMultiple: p95 / idleP95,
      p99,
      p99BaselineMultiple: p99 / idleP95,
      max: sorted.at(-1),
      over20: deltas.filter((value) => value > 20).length,
      over50: deltas.filter((value) => value > 50).length,
      longTasks: longTasks.length,
    };
  });

  console.log("story-performance", JSON.stringify(metrics));
  expect(metrics.frameCoverage, JSON.stringify(metrics)).toBeGreaterThanOrEqual(2 / 3);
  expect(metrics.p95BaselineMultiple, JSON.stringify(metrics)).toBeLessThanOrEqual(2.05);
  expect(metrics.p99BaselineMultiple, JSON.stringify(metrics)).toBeLessThanOrEqual(3.05);
  expect(metrics.over50, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
  expect(metrics.longTasks, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
});
