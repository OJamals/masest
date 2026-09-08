import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";

async function withServer(fn) {
  const staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

test("homepage first fold prioritizes replacement and trial without duplicate shortcuts", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });

    try {
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      const result = await page.evaluate(() => {
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const ctas = [...document.querySelectorAll("a, button")]
          .filter(isVisible)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
              top: rect.top,
              bottom: rect.bottom,
            };
          })
          .filter((item) => item.bottom <= window.innerHeight);

        return {
          ctas,
          shortcuts: [...document.querySelectorAll(".story-shortcuts a")]
            .filter(isVisible)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                text: (el.innerText || "").replace(/\s+/g, " ").trim(),
                href: el.getAttribute("href"),
                bottom: rect.bottom,
              };
            }),
          hasScrollCue: !!document.querySelector(".scroll-cue"),
        };
      });

      assert.equal(result.hasScrollCue, false, "first fold should not include a decorative scroll cue");
      assert.ok(result.ctas.some((cta) => cta.text === "Shop CRHD"), "matched product CTA should be visible in the first fold");
      assert.ok(result.ctas.some((cta) => cta.text === "Try it"), "trial CTA should be visible in the first fold");
      assert.deepEqual(result.shortcuts, [], "first fold should not repeat replacement actions in a shortcut rail");
    } finally {
      await browser.close();
    }
  });
});

test("homepage keeps a primary action visible on short mobile", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({
      viewport: { width: 390, height: 700 },
      reducedMotion: "reduce",
    });

    try {
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      const result = await page.evaluate(() => {
        const visibleInFold = (selector, text) => [...document.querySelectorAll(selector)].some((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const label = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
          return rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom <= window.innerHeight &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            label === text;
        });
        return {
          hasPrimary: visibleInFold(".story-actions a", "Shop CRHD"),
          hasTrial: visibleInFold(".story-actions a", "Try it"),
          visibleShortcuts: [...document.querySelectorAll(".story-shortcuts a")].filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }).length,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      assert.equal(result.hasPrimary, true, "short mobile should keep the primary product path visible");
      assert.equal(result.hasTrial, true, "short mobile should keep the trial path visible");
      assert.equal(result.visibleShortcuts, 0, "short mobile should hide the secondary shortcut rail");
      assert.equal(result.overflow, false, "short mobile should not create horizontal overflow");
    } finally {
      await browser.close();
    }
  });
});

test("homepage first scene separates the persistent object from compact iPad copy", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({
      // Playwright's iPad (gen 11) CSS width; height matches the reported crop.
      viewport: { width: 656, height: 683 },
      deviceScaleFactor: 2,
      reducedMotion: "no-preference",
    });

    try {
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (
        document.getElementById("story")?.classList.contains("story-mobile-ready")
      ));
      const result = await page.evaluate(async () => {
        const act = document.querySelector('.story .act[data-act="1"]');
        act.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 350));
        const rect = (selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return {
            left: Math.round(box.left),
            right: Math.round(box.right),
            top: Math.round(box.top),
            bottom: Math.round(box.bottom),
            width: Math.round(box.width),
          };
        };
        const copy = rect('.story .act[data-act="1"] .act-content');
        const object = rect(".story-object__card");
        return {
          copy,
          object,
          sceneEnvelope: Math.max(copy.right, object.right) - Math.min(copy.left, object.left),
          mobileReady: document.getElementById("story").classList.contains("story-mobile-ready"),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      assert.equal(result.mobileReady, true, JSON.stringify(result));
      assert.ok(result.sceneEnvelope >= 656 * 0.75, JSON.stringify(result));
      assert.ok(result.copy.left >= 15, JSON.stringify(result));
      assert.ok(result.copy.right <= result.object.left - 16, JSON.stringify(result));
      assert.ok(result.copy.width >= 230, JSON.stringify(result));
      assert.ok(result.object.width >= 320, JSON.stringify(result));
      assert.ok(result.object.right <= 656, JSON.stringify(result));
      assert.equal(result.overflow, false, JSON.stringify(result));
    } finally {
      await browser.close();
    }
  });
});

test("homepage compact iPad story never layers its proof card over chapter copy", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser({ channel: "chrome" });
    const page = await browser.newPage({
      viewport: { width: 760, height: 1024 },
      deviceScaleFactor: 2,
      reducedMotion: "no-preference",
    });

    try {
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (
        document.getElementById("story")?.classList.contains("story-mobile-ready")
      ));
      await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
      await page.evaluate(() => document.fonts.ready);
      const overlaps = await page.evaluate(async () => {
        const story = document.getElementById("story");
        const card = story.querySelector(".story-object__card");
        const samples = [];
        const visited = new Set();
        const start = story.offsetTop;
        const end = story.offsetTop + story.offsetHeight - innerHeight;

        for (let step = 0; step <= 36; step += 1) {
          const y = start + (end - start) * (step / 36);
          scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 80));
          visited.add(story.dataset.activeScene);
          const visual = card.getBoundingClientRect();

          for (const content of story.querySelectorAll(".act-content")) {
            const style = getComputedStyle(content);
            if (style.visibility === "hidden" || Number(style.opacity) < .05) continue;
            const copy = content.getBoundingClientRect();
            const width = Math.max(0, Math.min(visual.right, copy.right) - Math.max(visual.left, copy.left));
            const height = Math.max(0, Math.min(visual.bottom, copy.bottom) - Math.max(visual.top, copy.top));
            if (width > 1 && height > 1) {
              samples.push({
                step,
                scene: story.dataset.activeScene,
                width: Math.round(width),
                height: Math.round(height),
              });
            }
          }
        }

        return { overlaps: samples, visited: [...visited] };
      });

      assert.deepEqual(overlaps.overlaps, []);
      assert.deepEqual(overlaps.visited, [
        "kitchen-grease",
        "cip-vessel",
        "labelle-fermenter",
        "shower-track",
        "airboat-panel",
        "pool-cartridge",
      ]);
    } finally {
      await browser.close();
    }
  });
});
