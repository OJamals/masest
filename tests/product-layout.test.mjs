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

test("product grid lays out 4-5 clickable cards per row at desktop width", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
      const layout = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".shop-card")];
        const top = cards[0]?.offsetTop;
        return {
          total: cards.length,
          perRow: cards.filter((c) => c.offsetTop === top).length,
        allLink: cards.every((c) => {
          const link = c.querySelector(".shop-card-link");
          return link && /product\.html\?id=/.test(link.getAttribute("href"));
        }),
        nestedInteractive: cards.some((c) => c.querySelector("a button, button a"))
        };
      });

      assert.equal(layout.total, 16, "expected all 16 product cards in the grid");
      assert.ok(layout.perRow >= 4 && layout.perRow <= 5, `expected 4-5 cards/row, got ${layout.perRow}`);
      assert.ok(layout.allLink, "every card should be a clickable product link");
      assert.equal(layout.nestedInteractive, false, "cart buttons should not be nested inside links");
    } finally {
      await browser.close();
    }
  });
});

test("replacement checker shows the swap and filters the catalog", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

      await page.click('.swap-row[data-row="0"]');
      await page.waitForSelector("#swapResult:not([hidden])");
      const filtered = await page.$$eval(".shop-card", (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(filtered, ["hcr", "descaler", "crs"], "checker should filter to the matching swaps");

      await page.click("#swapClear");
      await page.waitForFunction(() => document.querySelectorAll(".shop-card").length === 16);
      const restored = await page.$$eval(".shop-card", (els) => els.length);
      assert.equal(restored, 16, "clearing should restore the full line");

      await page.click('.shop-chip[data-group="water"]');
      const water = await page.$$eval(".shop-card", (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(water, ["watersafe60", "cr2", "sar", "purgo", "dbnpa"], "category chip should filter the grid");
    } finally {
      await browser.close();
    }
  });
});
