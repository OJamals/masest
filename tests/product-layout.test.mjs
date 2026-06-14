import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      try {
        const response = await fetch(`${BASE_URL}/products.html`);
        if (response.ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

test("product catalog rails keep cards readable at desktop width", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
      const narrowCards = await page.evaluate(() =>
        ["descaleProducts", "degreaseProducts", "waterProducts", "exteriorProducts"]
          .flatMap((id) =>
            [...document.getElementById(id).querySelectorAll(".prod-card")].map((card) => ({
              id,
              title: card.querySelector("h3")?.textContent?.trim(),
              width: Math.round(card.getBoundingClientRect().width)
            }))
          )
          .filter((card) => card.width < 270)
      );

      assert.deepEqual(narrowCards, []);
    } finally {
      await browser.close();
    }
  });
});

test("product family jump links land the target near the top", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
      await page.click('a[href="#catalog"]');
      await page.click('.catalog-jumpbar a[href="#water"]');
      await page.waitForFunction(() => {
        const top = Math.round(document.getElementById("water").getBoundingClientRect().top);
        return top >= 70 && top <= 160;
      });

      const top = await page.$eval("#water", (section) =>
        Math.round(section.getBoundingClientRect().top)
      );
      assert.ok(top >= 70 && top <= 160, `expected #water near top, got ${top}px`);
    } finally {
      await browser.close();
    }
  });
});
