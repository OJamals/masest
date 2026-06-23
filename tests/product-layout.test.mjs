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
          return link && /products\/[a-z0-9-]+/.test(link.getAttribute("href"));
        }),
        nestedInteractive: cards.some((c) => c.querySelector("a button, button a"))
        };
      });

      assert.equal(layout.total, 20, "expected all 20 launch product cards in the grid");
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
      assert.deepEqual(filtered, ["hcr", "descaler"], "checker should filter to the matching swaps");

      await page.click("#swapClear");
      await page.waitForFunction(() => document.querySelectorAll(".shop-card").length === 20);
      const restored = await page.$$eval(".shop-card", (els) => els.length);
      assert.equal(restored, 20, "clearing should restore the full launch line");

      await page.click('.shop-chip[data-group="water"]');
      const water = await page.$$eval(".shop-card", (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(water, ["watersafe60", "cr2", "sar", "purgo"], "category chip should filter the grid");

      await page.click('.shop-chip[data-group="glycol"]');
      const glycol = await page.$$eval(".shop-card", (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(glycol, ["pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"], "glycol category chip should filter the grid");
    } finally {
      await browser.close();
    }
  });
});

test("product job router headline does not overlap its copy", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      for (const viewport of [
        { width: 390, height: 900 },
        { width: 1440, height: 1000 },
      ]) {
        const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
        try {
          await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });
          const rects = await page.evaluate(() => {
            const headline = document.querySelector(".product-job-router .headline");
            const copy = document.querySelector(".product-job-router-copy");
            return {
              headlineBottom: headline.getBoundingClientRect().bottom,
              copyTop: copy.getBoundingClientRect().top,
            };
          });
          assert.ok(
            rects.copyTop - rects.headlineBottom >= 8,
            `headline/copy gap collapsed at ${viewport.width}px`,
          );
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
});

test("product detail renders HMIS panel rows from product data", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    try {
      await page.route("**/data/drum-pricing.json", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      });
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#pName")?.textContent.includes("VertKleen HCR"));
      await page.waitForTimeout(300);
      const rows = await page.$$eval("#panelRows .hmis-row", (els) =>
        els.map((el) => ({
          label: el.querySelector(".lbl")?.textContent.trim(),
          value: el.querySelector(".val")?.textContent.trim(),
        }))
      );
      assert.deepEqual(rows, [
        { label: "Health", value: "0" },
        { label: "Flammability", value: "0" },
        { label: "Reactivity", value: "0" },
      ]);
      await browser.close();
    } catch (error) {
      await browser.close();
      throw error;
    }
  });
});

test("static product detail renders specs uses and docs without commerce API", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    try {
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#pName")?.textContent.includes("VertKleen HCR"));
      await page.waitForFunction(() => document.querySelector("#pSpecs")?.textContent.includes("HMIS 0-0-0"));
      const content = await page.evaluate(() => ({
        specs: document.querySelector("#pSpecs")?.textContent || "",
        uses: document.querySelector("#pUses")?.textContent || "",
        docs: document.querySelector("#pDocs")?.textContent || "",
        mediaHidden: document.querySelector("#pMediaSection")?.hasAttribute("hidden")
      }));
      assert.match(content.specs, /SynTech|SYNTEC|Synthetic acid/i);
      assert.match(content.uses, /Cooling tower|Rust removal|passivation/i);
      assert.match(content.docs, /Safety Data Sheet/);
      assert.equal(content.mediaHidden, false, "field photos section should render from static product data");
    } finally {
      await browser.close();
    }
  });
});

test("non-canonical CRS page stays quote-only and does not inherit Descaler checkout", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    try {
      await page.addInitScript(() => {
        window.MASEST_ENABLE_LOCAL_API = true;
      });
      await page.route("**/api/products", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          products: [{
            sku: "descaler",
            name: "VertKleen Descaler",
            mode: "buy",
            active: true,
            product_variants: [{
              vsku: "VK-DSC-1",
              label: "1 gal",
              gallons: 1,
              price: 12.02,
              currency: "usd",
              active: true,
              sort: 1
            }]
          }]
        })
      }));
      await page.goto(`${BASE_URL}/product.html?id=crs`, { waitUntil: "networkidle" });
      const state = await page.evaluate(() => ({
        name: document.querySelector("#pName")?.textContent || "",
        addVisible: !document.querySelector("#pBuyBtn")?.hidden,
        drumVisible: !document.querySelector("#pDrums")?.hidden,
        quoteText: document.querySelector("#pQuoteBtn")?.textContent || ""
      }));
      assert.equal(state.name, "VertKleen CRS");
      assert.equal(state.addVisible, false, "CRS must not borrow Descaler add-cart variants");
      assert.equal(state.drumVisible, false, "CRS must not borrow Descaler drum pricing");
      assert.match(state.quoteText, /quote|Request/i);
    } finally {
      await browser.close();
    }
  });
});
