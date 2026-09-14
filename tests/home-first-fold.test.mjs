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
    const browser = await launchTestBrowser();
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
    const browser = await launchTestBrowser();
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
          hasPrimary: visibleInFold(".hero-ctas a", "Shop CRHD"),
          hasTrial: visibleInFold(".hero-ctas a", "Try it"),
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
