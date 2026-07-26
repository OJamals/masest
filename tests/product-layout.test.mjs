import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import {
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCTS,
} from "../js/main/catalog-data.js";
import { catalogCard, catalogDecisionHTML } from "../js/main/commerce-ui.js";

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = new URL("..", import.meta.url);

function serverReady() {
  return fetch(`${BASE_URL}/products.html`)
    .then((response) => response.ok)
    .catch(() => false);
}

function htmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

test("catalog cards derive compact proof and fit cues from catalog data", () => {
  for (const id of CATALOG_ORDER) {
    const html = catalogCard(id);
    const source = PRODUCT_CATALOG_COPY[id];
    const renderedFits = [...html.matchAll(/<li class="shop-card-fit">([^<]+)<\/li>/g)]
      .map((match) => match[1]);

    assert.deepEqual(renderedFits, source.fits.slice(0, 3), `${id} should render only source fit data`);
    assert.equal(renderedFits.length, Math.min(source.fits.length, 3));
    assert.ok(
      html.includes(`<span class="shop-card-proof-cue">${source.proof}</span>`),
      `${id} should render its source proof verbatim`,
    );
    assert.ok(
      html.includes(
        `class="shop-card-proof-link" href="products/${id}" aria-label="Review proof for ${PRODUCTS[id].name}"`,
      ),
      `${id} should route proof review to its detail page`,
    );
  }
});

test("catalog decision cues omit missing rows without empty chrome", () => {
  assert.equal(catalogDecisionHTML("hcr", {}), "");

  const fitOnly = catalogDecisionHTML("hcr", { fits: ["HVAC"] });
  assert.match(fitOnly, /shop-card-fit-list/);
  assert.doesNotMatch(fitOnly, /shop-card-proof/);

  const proofOnly = catalogDecisionHTML("hcr", { proof: PRODUCT_CATALOG_COPY.hcr.proof });
  assert.match(proofOnly, /shop-card-proof-cue/);
  assert.doesNotMatch(proofOnly, /shop-card-fit-list/);
});

test("catalog decision cues preserve existing buyable and quote-first actions", () => {
  for (const [id, actionMarker, expectsDecision] of [
    ["hcr", 'data-commerce-action="hcr"', true],
    ["crs", "shop-card-quote", false],
  ]) {
    const html = catalogCard(id);
    assert.ok(html.includes(actionMarker), `${id} should retain its existing commerce action`);
    if (expectsDecision) {
      assert.ok(
        html.indexOf(actionMarker) < html.indexOf("shop-card-decision"),
        `${id} commerce action should remain before supporting decision cues`,
      );
    } else {
      assert.doesNotMatch(html, /shop-card-decision/, `${id} has no supported proof-detail route`);
    }
  }

  assert.match(
    catalogCard("crs"),
    /contact\?type=quote&product=[^"]+#quoteForm/,
    "quote-first cards should land buyers at the contextual request form",
  );
});

async function gotoDomReady(page, path, selector) {
  await page.goto(`${BASE_URL}/${path}`, { waitUntil: "load" });
  if (selector) await page.waitForSelector(selector, { state: "attached" });
}

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      const ready = await serverReady();
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    if (!exited) server.kill("SIGTERM");
    await Promise.race([
      exitedOnce,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (!exited) {
      server.kill("SIGKILL");
      await Promise.race([
        exitedOnce,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
  }
}

test("product grid lays out 4-5 clickable cards per row at desktop width", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await gotoDomReady(page, "products.html", ".shop-card");
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

      assert.equal(layout.total, 15, "expected all 15 confirmed price-list product cards in the grid");
      assert.ok(layout.perRow >= 4 && layout.perRow <= 5, `expected 4-5 cards/row, got ${layout.perRow}`);
      assert.ok(layout.allLink, "every card should be a clickable product link");
      assert.equal(layout.nestedInteractive, false, "cart buttons should not be nested inside links");
    } finally {
      await browser.close();
    }
  });
});

test("products page thumbnails use the blue media stage", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, reducedMotion: "reduce" });
    try {
      await gotoDomReady(page, "products.html", ".shop-card-media img");
      const cardMedia = await page.evaluate(() => {
        const media = document.querySelector(".products-page .shop-card-media");
        const img = media?.querySelector("img");
        const mediaStyle = media ? getComputedStyle(media) : null;
        return {
          imgSrc: img?.getAttribute("src") || "",
          backgroundColor: mediaStyle?.backgroundColor || "",
          backgroundImage: mediaStyle?.backgroundImage || "",
        };
      });

      assert.match(cardMedia.imgSrc, /^img\/products\//, "product cards should use product thumbnail assets");
      assert.equal(cardMedia.backgroundColor, "rgb(227, 240, 241)", "products page thumbnails should use the blue product-card background");
      assert.match(cardMedia.backgroundImage, /14,\s*124,\s*134/, "products page thumbnails should include the teal blue wash");
    } finally {
      await browser.close();
    }
  });
});

test("commerce size labels stay readable and bulk quote actions stay centered", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, reducedMotion: "reduce" });
    try {
      await gotoDomReady(page, "products.html", ".shop-card-buybar");
      const controls = await page.evaluate(() => {
        const buybar = document.querySelector(".shop-card-buybar");
        buybar.innerHTML = `<span class="shop-card-commerce">
          <span class="commerce-buy">
            <select class="commerce-vol" aria-label="Volume">
              <option>1 gal jug</option>
              <option>55 gal — quoted</option>
              <option>275 gal — quoted</option>
            </select>
            <a class="shop-card-add commerce-quote-swap" href="#">Request quote</a>
          </span>
        </span>`;

        const select = buybar.querySelector(".commerce-vol");
        const quote = buybar.querySelector(".commerce-quote-swap");
        const selectRect = select.getBoundingClientRect();
        const quoteRect = quote.getBoundingClientRect();
        const quoteStyle = getComputedStyle(quote);
        return {
          selectWidth: selectRect.width,
          quoteHeight: quoteRect.height,
          quoteDisplay: quoteStyle.display,
          quoteAlign: quoteStyle.alignItems,
          quoteJustify: quoteStyle.justifyContent,
        };
      });

      assert.ok(controls.selectWidth >= 180, `expected readable size selector, got ${controls.selectWidth}px`);
      assert.ok(controls.quoteHeight >= 44, `expected 44px quote target, got ${controls.quoteHeight}px`);
      assert.match(controls.quoteDisplay, /flex/);
      assert.equal(controls.quoteAlign, "center");
      assert.equal(controls.quoteJustify, "center");
    } finally {
      await browser.close();
    }
  });
});

test("static product detail heroes publish full catalog copy", () => {
  for (const id of CATALOG_ORDER) {
    const product = PRODUCTS[id];
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");
    const subhead = html.match(/<p class="subhead">([^<]*)<\/p>/)?.[1] || "";

    assert.ok(subhead, `${id} static detail page should include hero copy`);
    assert.ok(
      subhead.includes(htmlText(product.desc)),
      `${id} hero copy should include the full product description`,
    );
    assert.ok(!subhead.includes("..."), `${id} hero copy should not be pre-truncated`);
  }
});

test("catalog category controls filter the product grid", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await gotoDomReady(page, "products.html", ".shop-card");

      await page.click('.shop-chip[data-group="water"]');
      const water = await page.$$eval(".shop-card", (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(water, ["cr2", "purgo", "watersafe60"], "category chip should filter the grid");

      const glycolChip = await page.$('.shop-chip[data-group="glycol"]');
      assert.equal(glycolChip, null, "glycol chip should be removed from the confirmed price-list catalog");
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
          await gotoDomReady(page, "products.html", ".product-job-router .headline");
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

test("public CTA groups keep a consistent gap from their lead copy", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const cases = [
      ["services.html", ".services-hero-copy .subhead", ".services-hero-copy .hero-actions", 28, 36],
      ["proof.html", ".page-hero .subhead", ".page-hero .btn", 28, 36],
      ["proof.html", ".proof-source-summary .subhead", ".proof-source-summary .proof-doc-link", 22, 32],
      ["about.html", "#serviceCatalog .subhead", "#serviceCatalog .btn", 28, 36],
      ["industries.html", ".block-dark .section-head .subhead", ".block-dark .section-head .btn", 28, 36],
      ["programs.html", ".cta-band .subhead", ".cta-band .btn", 34, 42],
      ["resources.html", ".cta-band .subhead", ".cta-band .btn", 34, 42],
    ];

    try {
      for (const viewport of [
        { width: 390, height: 900 },
        { width: 1440, height: 1000 },
      ]) {
        const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
        try {
          for (const [path, beforeSelector, actionSelector, minGap, maxGap] of cases) {
            await gotoDomReady(page, path, beforeSelector);
            await page.waitForSelector(actionSelector, { state: "attached" });
            const gap = await page.evaluate(({ beforeSelector, actionSelector }) => {
              const before = document.querySelector(beforeSelector);
              const action = document.querySelector(actionSelector);
              if (!before || !action) return null;
              const beforeRect = before.getBoundingClientRect();
              const actionRect = action.getBoundingClientRect();
              return Math.round(actionRect.top - beforeRect.bottom);
            }, { beforeSelector, actionSelector });

            assert.ok(gap !== null, `${path} missing ${beforeSelector} or ${actionSelector}`);
            assert.ok(
              gap >= minGap && gap <= maxGap,
              `${path} ${actionSelector} gap ${gap}px should stay between ${minGap}px and ${maxGap}px at ${viewport.width}px`,
            );
          }
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
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#pName")?.textContent.includes("VertKleen CIP HCR"));
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

test("product detail related products render thumbnails on the blue media stage", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    try {
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#relatedWrap:not([hidden]) .shop-card-media img");
      const related = await page.evaluate(() => {
        const media = document.querySelector("#relatedWrap .shop-card-media");
        const img = media?.querySelector("img");
        const mediaStyle = media ? getComputedStyle(media) : null;
        const imgRect = img?.getBoundingClientRect();
        return {
          imgSrc: img?.getAttribute("src") || "",
          mediaBackgroundColor: mediaStyle?.backgroundColor || "",
          mediaBackgroundImage: mediaStyle?.backgroundImage || "",
          imgWidth: Math.round(imgRect?.width || 0),
          imgHeight: Math.round(imgRect?.height || 0),
        };
      });

      assert.match(related.imgSrc, /^img\/products\//, "related products should use product thumbnail assets");
      assert.equal(related.mediaBackgroundColor, "rgb(227, 240, 241)", "related thumbnail stage should use the blue product-card background");
      assert.match(related.mediaBackgroundImage, /14,\s*124,\s*134/, "related thumbnail stage should include the teal blue wash");
      assert.ok(related.imgWidth > 100, "related product image should be visible");
      assert.ok(related.imgHeight > 100, "related product image should be visible");
    } finally {
      await browser.close();
    }
  });
});

test("static product detail renders specs uses and docs without commerce API", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    try {
      await page.goto(`${BASE_URL}/product.html?id=hcr`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#pName")?.textContent.includes("VertKleen CIP HCR"));
      await page.waitForFunction(() => document.querySelector("#pSpecs")?.textContent.includes("Current SDS"));
      const content = await page.evaluate(() => ({
        specs: document.querySelector("#pSpecs")?.textContent || "",
        uses: document.querySelector("#pUses")?.textContent || "",
        docs: document.querySelector("#pDocs")?.textContent || "",
        mediaHidden: document.querySelector("#pMediaSection")?.hasAttribute("hidden")
      }));
      assert.match(content.specs, /Current SDS.*Controlled acid step/i);
      assert.match(content.uses, /Beer-stone|brewery CIP|heat-exchanger/i);
      assert.match(content.docs, /Safety Data Sheet/);
      assert.equal(content.mediaHidden, false, "field photos section should render from static product data");
    } finally {
      await browser.close();
    }
  });
});

test("static product detail keeps the price panel clear of the following card", async () => {
  await withServer(async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.addInitScript(() => {
        window.MASEST_ENABLE_LOCAL_API = true;
      });
      await page.route("**/api/products", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          products: [{
            sku: "cr",
            name: "VertKleen CIP CR",
            mode: "buy",
            active: true,
            product_variants: [{
              vsku: "VK-CR-1G",
              label: "1 gal jug",
              gallons: 1,
              price: 19.27,
              currency: "usd",
              active: true,
              sort: 1
            }]
          }]
        })
      }));
      await page.goto(`${BASE_URL}/products/cr.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-commerce-price="cr"]:not([hidden])');
      const gap = await page.evaluate(() => {
        const price = document.querySelector('.product-hero-buy .shop-card-price');
        const nextSection = document.querySelector('.product-static-section');
        return nextSection.getBoundingClientRect().top - price.getBoundingClientRect().bottom;
      });
      assert.ok(gap >= 32, `price panel should have at least 32px before the next card, got ${gap.toFixed(1)}px`);
    } finally {
      await browser.close();
    }
  });
});

test("non-canonical CRS route shows the current-catalog fallback and no checkout", async () => {
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
      await page.goto(`${BASE_URL}/product.html?id=crs`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("That product is not in the current catalog."));
      const state = await page.evaluate(() => ({
        main: document.querySelector("main")?.textContent || "",
        addVisible: Boolean(document.querySelector("#pBuyBtn") && !document.querySelector("#pBuyBtn").hidden),
        volSelect: !!document.querySelector("#pVol"),
        bulkQuoteBtn: !!document.querySelector("#pBulkQuoteBtn"),
        quoteText: document.querySelector("main a[href*='contact?type=quote']")?.textContent || ""
      }));
      assert.match(state.main, /not in the current catalog/i);
      assert.equal(state.addVisible, false, "CRS must not borrow Descaler add-cart variants");
      assert.equal(state.volSelect, false, "CRS must not borrow Descaler volume selector");
      assert.equal(state.bulkQuoteBtn, false, "CRS must not borrow Descaler bulk quote CTA");
      assert.match(state.quoteText, /quote|Request/i);
    } finally {
      await browser.close();
    }
  });
});
