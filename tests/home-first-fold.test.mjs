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
      assert.ok(result.ctas.some((cta) => cta.text === "Shop by cleaning job"), "product CTA should be visible in the first fold");
      assert.ok(result.ctas.some((cta) => cta.text === "Plan a field trial"), "quote CTA should be visible in the first fold");
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
          hasPrimary: visibleInFold("a, button", "Shop by cleaning job"),
          hasTrial: visibleInFold("a, button", "Plan a field trial"),
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

test("homepage first scene uses the compact stacked iPad fallback", async () => {
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
      await page.waitForFunction(() => {
        const copy = document.querySelector('.story .act[data-act="1"] .act-copy');
        const reel = document.querySelector('.story .act[data-act="1"] .reel');
        return copy?.getBoundingClientRect().width > 0 && reel?.getBoundingClientRect().width > 0;
      });
      const result = await page.evaluate(() => {
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
        const copy = rect('.story .act[data-act="1"] .act-copy');
        const reel = rect('.story .act[data-act="1"] .reel');
        return {
          copy,
          reel,
          sceneEnvelope: Math.max(copy.right, reel.right) - Math.min(copy.left, reel.left),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      assert.ok(result.sceneEnvelope >= 656 * 0.75, JSON.stringify(result));
      assert.ok(result.reel.top >= result.copy.bottom + 16, JSON.stringify(result));
      assert.ok(result.copy.width >= 250, JSON.stringify(result));
      assert.ok(result.reel.width >= 240, JSON.stringify(result));
      assert.ok(result.reel.right <= 656, JSON.stringify(result));
      assert.equal(result.overflow, false, JSON.stringify(result));
    } finally {
      await browser.close();
    }
  });
});
