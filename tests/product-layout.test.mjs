import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import {
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCTS,
  productHighlights,
} from "../js/main/catalog-data.js";
import { catalogCard, catalogDecisionHTML } from "../js/main/commerce-ui.js";

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = new URL("..", import.meta.url);
const readProject = (path) => readFileSync(new URL(path, PROJECT_ROOT), "utf8");

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

test("product highlights come from the shared marketing-science source", () => {
  for (const id of Object.keys(PRODUCTS)) {
    const highlights = productHighlights(id);
    assert.equal(highlights.length, 4, `${id}: four concise highlights`);
    assert.doesNotMatch(
      highlights.flat().join(" "),
      /claim boundary|document-gated|current SDS|approval|verification incomplete/i,
      `${id}: no legacy claim-firewall copy`,
    );
  }
});

test("generated product pages reuse existing highlights without added science or authority sections", () => {
  for (const id of CATALOG_ORDER) {
    const html = readProject(`products/${id}.html`);
    assert.doesNotMatch(html, /product-science-section|authority-section|authority-records/);
    assert.match(html, /<b>How it works<\/b>/);
    assert.match(html, /<b>Why buyers switch<\/b>/);
    assert.match(html, /<b>Result record<\/b>/);
  }
});

test("generated product routes own the complete public detail surface", () => {
  assert.equal(existsSync(new URL("../product.html", import.meta.url)), false);

  for (const id of CATALOG_ORDER) {
    const html = readProject(`products/${id}.html`);
    assert.match(html, new RegExp(`data-commerce-media="${id}"`));
    assert.match(html, new RegExp(`data-commerce-action="${id}"`));
    assert.match(html, /data-reviews data-sku="[^"]+" data-kind="product"/);
    assert.match(html, /data-cms-content="page_sections" data-cms-page="product"/);
  }
});

test("approved product pages publish representative application scenes outside proof", () => {
  const applicationImages = {
    alumibrite: "alumibrite-aluminum-test-patch-v1.webp",
    cr: "cip-cycle-skid-v1.webp",
    "cr-hd-low-foam": "cr-hd-low-foam-machine-wash-v1.webp",
    descaler: "hvac-descaling-loop-v1.webp",
    hcr: "cip-cycle-skid-v1.webp",
    "hcr-t16": "hvac-descaling-loop-v1.webp",
    lam3: "lam3-exterior-surface-trial-v1.webp",
    neutral: "neutral-material-test-patch-v1.webp",
    purgo: "purgo-controlled-drain-maintenance-v1.webp",
    sar: "sar-application-engineering-v1.webp",
  };

  for (const [id, filename] of Object.entries(applicationImages)) {
    const html = readProject(`products/${id}.html`);
    const figure = html.match(/<figure class="product-application-media">[\s\S]*?<\/figure>/)?.[0] || "";
    assert.match(
      figure,
      new RegExp(`/img/representative/applications/${filename.replaceAll(".", "\\.")}`),
      `${id} should render its approved representative scene`,
    );
    assert.match(figure, /<b>Representative application<\/b>/);
    assert.doesNotMatch(figure, /proof|evidence/i);
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
    const copy = PRODUCT_CATALOG_COPY[id];
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");
    const subhead = html.match(/<p class="subhead">([^<]*)<\/p>/)?.[1] || "";

    assert.ok(subhead, `${id} static detail page should include hero copy`);
    assert.ok(
      subhead.includes(htmlText(copy.summary)),
      `${id} hero copy should include the conversion summary`,
    );
    assert.ok(!subhead.includes("..."), `${id} hero copy should not be pre-truncated`);
  }
});

test("all product pages explain platform science, operator advantage, and next action", () => {
  for (const id of CATALOG_ORDER) {
    const copy = PRODUCT_CATALOG_COPY[id];
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");

    assert.ok(copy.platform?.trim(), `${id}: platform`);
    assert.ok(copy.mechanism?.trim(), `${id}: mechanism`);
    assert.ok(copy.operator_advantage?.trim(), `${id}: operator advantage`);
    assert.match(html, /How it works/);
    assert.ok(html.includes(htmlText(copy.mechanism)), `${id}: mechanism copy`);
    assert.ok(html.includes(htmlText(copy.operator_advantage)), `${id}: operator advantage copy`);
    assert.ok(
      html.includes(htmlText(copy.sample_cta || "Request free sample")),
      `${id}: sample action`,
    );
    assert.ok(
      html.includes(htmlText(copy.quote_cta || "Request a quote")),
      `${id}: quote action`,
    );
  }
});

test("all public products route quote actions by buyer job", () => {
  const expected = {
    hcr: "Request a CIP mineral-cycle review",
    "hcr-t16": "Request a bulk HVAC scale review",
    descaler: "Request a deposit test",
    sar: "Request an engineered application review",
    cr: "Request a CIP soil-cycle review",
    cr2: "Request an HVAC CR application review",
    crhd: "Request a wash benchmark",
    "cr-hd-low-foam": "Request a machine-wash benchmark",
    neutral: "Request a material-fit test",
    multiwash: "Request a mixed-soil trial",
    watersafe60: "Request a water-program review",
    purgo: "Request an odor-program assessment",
    lam3: "Request an exterior-surface trial",
    alumibrite: "Request an aluminum test-patch review",
    torque: "Request a fleet or marine wash trial",
  };
  assert.deepEqual(Object.keys(expected).sort(), [...CATALOG_ORDER].sort());
  for (const [id, label] of Object.entries(expected)) {
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");
    assert.match(html, new RegExp(`href="[^"]*#quoteForm">${label}</a>`), `${id}: job-scoped quote action`);
  }
});

test("product pages deep-link only scope-matched approved result summaries", () => {
  const expected = {
    hcr: ["brewery-cip-trials"],
    cr: ["brewery-cip-trials"],
    descaler: ["fire-pump-descaler", "residential-ac-coil"],
    crhd: ["commercial-kitchen-crhd", "distribution-center-assessment"],
    lam3: ["property-grout-moss"],
    alumibrite: ["airboat-alumibrite"],
    torque: ["airboat-alumibrite"],
  };
  const resultSlugs = [...new Set(Object.values(expected).flat())];
  for (const id of CATALOG_ORDER) {
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");
    const own = new Set(expected[id] || []);
    for (const slug of resultSlugs) {
      const link = new RegExp(`href="\\.\\.\\/proof#${slug}"`);
      if (own.has(slug)) assert.match(html, link, `${id}: mapped result ${slug}`);
      else assert.doesNotMatch(html, link, `${id}: unrelated result ${slug}`);
    }
  }
  for (const id of Object.keys(expected)) {
    const html = readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8");
    assert.match(html, /Documented result summary/);
  }
});

test("specialty product pages scope trials without blanket or endorsement language", () => {
  const pages = Object.fromEntries(
    ["purgo", "lam3", "alumibrite", "torque"]
      .map((id) => [id, readFileSync(new URL(`products/${id}.html`, PROJECT_ROOT), "utf8")]),
  );
  assert.match(pages.purgo, /source, loading, dose, monitoring, and cleaning method/i);
  assert.match(pages.lam3, /substrate, stain, weather, adjacent materials, dwell, runoff path, and visual endpoint/i);
  assert.match(pages.alumibrite, /alloy, coating, oxidation, method, containment, and test-patch endpoint/i);
  assert.match(pages.torque, /surface finish, soil, application method, containment, and appearance endpoint/i);
  assert.doesNotMatch(
    Object.values(pages).join("\n"),
    /Yellowfin|tourist airboat|landscape friendliness|material-friendly|microbial burden|general use|Brightening Index 90\.1/i,
  );
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
            name: "VertKlean CIP CR",
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
