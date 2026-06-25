import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4188;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      try {
        const response = await fetch(`${BASE_URL}/index.html`);
        if (response.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

test("homepage first fold shows product path and quote path without scroll cue", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
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
      assert.ok(result.ctas.some((cta) => cta.text === "Find the Replacement"), "product CTA should be visible in the first fold");
      assert.ok(result.ctas.some((cta) => cta.text === "Scope a Trial"), "quote CTA should be visible in the first fold");
      assert.deepEqual(
        result.shortcuts.map((shortcut) => shortcut.href),
        ["products#swap", "proof", "account"],
        "first fold should expose product, proof, and buyer-account fast paths",
      );
      assert.ok(result.shortcuts.every((shortcut) => shortcut.bottom <= 1000), "fast paths should remain in the first fold");
      await browser.close();
    } catch (error) {
      await browser.close();
      throw error;
    }
  });
});

test("homepage keeps a primary action visible on short mobile", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
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
          hasPrimary: visibleInFold("a, button", "Find the Replacement"),
          visibleShortcuts: [...document.querySelectorAll(".story-shortcuts a")].filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }).length,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      assert.equal(result.hasPrimary, true, "short mobile should keep the primary product path visible");
      assert.equal(result.visibleShortcuts, 0, "short mobile should hide the secondary shortcut rail");
      assert.equal(result.overflow, false, "short mobile should not create horizontal overflow");
      await browser.close();
    } catch (error) {
      await browser.close();
      throw error;
    }
  });
});
