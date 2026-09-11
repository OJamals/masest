// Core Web Vitals gate for the homepage. This is the spec the deploy hangs off:
// .github/workflows/verify.yml runs it as the `web_vitals` job, and the `verify` job —
// which contains the production deploy step — `needs:` it.
//
// It replaces the scrollybook's scroll frame budget, which was the site's only performance
// gate until the scrollybook was removed. Dropping that gate outright was the alternative,
// and it is how a 0.041 CLS survived on 117 pages for months: nothing was watching.
//
// Two budgets, both chosen from measured production numbers rather than round figures:
//
//   LCP — the homepage led with a 177KB photograph and measured 3,816ms on a throttled
//         phone. Text-led it measures ~1,400ms. The budget is set well above that but far
//         below the old figure, so re-introducing a heavy above-the-fold image fails here
//         instead of in the field.
//   CLS — production sits at 0.0003 after the nav-reserve fix. 0.01 leaves room for
//         rounding without letting a real shift back in.
//
// Measured against the static tree, not production: this must gate a commit BEFORE it
// deploys. Local numbers are faster than the field, which is why the budgets are generous —
// this catches structural regressions (an unsized hero image, a shifting injected element),
// not millisecond drift.
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "./playwright-test.mjs";
import { startStaticTestServer } from "./test-static-server.mjs";

const DIR = "output/playwright/homepage-vitals";
const LCP_BUDGET_MS = 2500;
const CLS_BUDGET = 0.01;
// The cart is now reserved in full -- lines, totals and the ZIP-estimate form -- so it
// holds a budget of its own rather than the 0.08 the half-finished reserve needed.
//
// Two budgets, because the cart has two honest states. Against a catalog that never
// prices (the local tree's own 404) the totals reserve is exact and the ZIP form never
// appears, so nothing moves. Against a priced catalog the form does appear, and whether
// it was reserved depends on a verdict the page can only have recorded on an earlier
// view: a first-ever cart view still pays that one reveal, ~124px on iPad Mini, and a
// repeat view pays nothing. Measured here at 768x1024, three samples each, against
// 0.0609 (unpriced) and 0.0871 (priced) on the same runner without the reserve:
//
//   unpriced      0.00026 / 0.00027 / 0.00026
//   priced, cold  0.01275 / 0.01274 / 0.01275
//   priced, warm  0.00044 / 0.00043 / 0.00044
//
// The budgets sit above those measurements, not at round figures.
//
// Before any of the reserve existed: 0.4967 (iPad Mini) / 0.4796 (Pixel 7) / 0.5578
// (three lines), and 0.1271 / 0.0808 in the field with only the lines reserved.
const CART_CLS_BUDGET = 0.01;
const CART_COLD_CLS_BUDGET = 0.02;
// Held open so the skeleton is still standing when CLS is sampled. Against the local
// static server /api/products 404s in single-digit milliseconds, so without this delay
// the swap lands before first paint and the assertion passes even with the reserve
// deleted -- a gate that guards nothing.
const CART_CATALOG_DELAY_MS = 1200;
const SAMPLES = 3;
// A single throttled run is flaky; require the median to pass rather than every sample, so
// one slow CI runner does not block a deploy while a real regression still does.
const REQUIRED_PASSING = 2;

let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

// Each sample gets its own page. addInitScript ACCUMULATES on a page, so reusing one across
// samples registers a second and third observer that all sum into the same counter — CLS
// then climbs 0.009 / 0.018 / 0.027 across three runs and looks like a real regression.
async function sampleVitals(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, lcpElement: null };
    new PerformanceObserver((list) => {
      const entry = list.getEntries().at(-1);
      if (!entry) return;
      window.__vitals.lcp = entry.startTime;
      const el = entry.element;
      window.__vitals.lcpElement = el
        ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`
        : null;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Shifts after a user gesture are the user's doing, not the page's.
        if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle", timeout: 45000 });
  // Let late-arriving chrome (the injected nav, lazy images) register any shift it causes.
  await page.waitForTimeout(1500);
  const vitals = await page.evaluate(() => ({ ...window.__vitals }));
  await page.close();
  return vitals;
}

test("homepage stays inside its Core Web Vitals budget", async ({ context }) => {
  const samples = [];
  for (let index = 0; index < SAMPLES; index += 1) samples.push(await sampleVitals(context));

  const passing = samples.filter(
    (s) => s.lcp > 0 && s.lcp <= LCP_BUDGET_MS && s.cls <= CLS_BUDGET,
  );
  const report = JSON.stringify({ budgets: { LCP_BUDGET_MS, CLS_BUDGET }, samples });

  expect(samples.every((s) => s.lcp > 0), `LCP never reported: ${report}`).toBe(true);
  expect(passing.length, `web-vitals budget: ${report}`).toBeGreaterThanOrEqual(REQUIRED_PASSING);
});

test("homepage LCP is not an oversized above-the-fold image", async ({ context, page }) => {
  // The regression this exists to stop: the homepage used to serve a 1200x1017 / 177KB
  // photograph into a 367x179 box, and the size of that one file moved LCP by 1.9s. Any
  // image promoted to LCP here must at least be sized for the box it renders into.
  const sample = await sampleVitals(context);
  if (!sample.lcpElement?.startsWith("img")) return;

  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle", timeout: 45000 });
  const oversized = await page.evaluate(() => {
    const images = [...document.querySelectorAll("img")];
    return images
      .filter((img) => {
        const rect = img.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.width === 0) return false;
        const needed = rect.width * (window.devicePixelRatio || 1);
        return img.naturalWidth > needed * 2.2;
      })
      .map((img) => ({
        src: img.currentSrc || img.src,
        natural: img.naturalWidth,
        rendered: Math.round(img.getBoundingClientRect().width),
      }));
  });

  expect(oversized, `above-the-fold images far larger than their box: ${JSON.stringify(oversized)}`)
    .toEqual([]);
});

// The cart is the page one tap before checkout and, until the pre-paint reserve landed,
// carried the site's worst layout instability by a wide margin: #cartLines shipped empty
// and .cart-summary shipped hidden, so a short "Loading cart details..." card was swapped
// for N full lines and the summary revealed together the moment /api/products resolved.
// One shift, FOOTER y:453 -> off-screen, worth 0.4967 on iPad Mini and 0.4796 on Pixel 7,
// rising to 0.5578 at three lines and measuring 0.0001 on an empty cart.
//
// Sampled at 768x1024, the worst of the five devices measured. tests/cart-reserve-contract
// holds the deterministic half: this asserts the outcome, that asserts the mechanism is
// still in place, because an outcome-only gate goes green when its subject stops running.
// The local tree has no prices, so the branch the field actually takes -- every line
// priced, the ZIP form offered -- is unreachable without supplying a catalog. Prices are
// the variable under test here, not a network characteristic, so fulfilling is right in
// this one place; the image test above still continues rather than fulfils, because
// there the bytes are the whole point.
const PRICED_CATALOG = {
  products: [{
    sku: "hcr",
    name: "VertKleen CIP HCR",
    active: true,
    mode: "buy",
    product_variants: [
      { vsku: "CRCIP-1G", label: "1 gal", gallons: 1, price: 28.99, currency: "usd", active: true, package_kind: "unit", sort: 1 },
      { vsku: "HCRCIP-25G", label: "2.5 gal", gallons: 2.5, price: 68.49, currency: "usd", active: true, package_kind: "unit", sort: 2 },
    ],
  }],
};

async function sampleCartCls(context, { priced = false, warm = false } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 768, height: 1024 });
  if (priced) await page.addInitScript(() => { window.MASEST_ENABLE_LOCAL_API = true; });
  await page.route("**/api/products*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, CART_CATALOG_DELAY_MS));
    // continue, never fulfil: substituting a body detaches the request from real
    // conditions, which is how a 48KB and a 127KB image once scored identically.
    if (!priced) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PRICED_CATALOG),
    });
  });
  await page.addInitScript(() => {
    window.__cartCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cartCls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  // Seed on the same origin before the cart page parses; the reserve reads it during parse.
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((keepVerdict) => {
    localStorage.setItem("masest_cart", JSON.stringify({ "CRCIP-1G": 2, "HCRCIP-25G": 1 }));
    // Samples share one browser context, so without this the second and third "cold"
    // runs inherit the verdict the first one recorded and quietly measure the warm path
    // instead -- two of three passing on a regressed cold path would still be green.
    if (!keepVerdict) localStorage.removeItem("masest_cart_estimable_v1");
  }, warm);
  if (warm) {
    // A second view of the cart in the same browser. The ZIP form's reserve replays a
    // verdict the page can only record once the catalog has answered, so this is the
    // state a returning buyer is in and the cold run above is the first-ever view.
    await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator(".cart-line:not(.cart-line-skeleton)").first().waitFor({ timeout: 30000 });
    await page.evaluate(() => { window.__cartCls = 0; });
  }
  // Not networkidle: the cart keeps chat, tracking and image requests in flight long
  // enough that quiescence never arrives, and it is the wrong signal regardless. Wait on
  // the swap this test exists to measure -- skeleton rows replaced by real ones -- then
  // let the shift it causes register.
  await page.goto(`${BASE_URL}/cart.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".cart-line:not(.cart-line-skeleton)").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => ({
    cls: window.__cartCls,
    lines: document.querySelectorAll(".cart-line").length,
    // A run where the ZIP form never appeared proves nothing about reserving it, and a
    // priced run that silently lost its prices would look like a pass.
    shipForm: !document.getElementById("shipEstimateForm")?.hidden,
    priced: /\$/.test(document.getElementById("cartEstimate")?.textContent || ""),
  }));
  await page.close();
  return result;
}

test("cart reserves its lines so hydration does not shift the page", async ({ context }) => {
  // Three samples that each deliberately hold the catalog open for CART_CATALOG_DELAY_MS
  // and then settle cannot fit in Playwright's 30s default, which overrides the per-
  // navigation timeout. The delay is the point of the test, so raise the budget rather
  // than shorten it into uselessness.
  test.setTimeout(120_000);
  const samples = [];
  for (let index = 0; index < SAMPLES; index += 1) samples.push(await sampleCartCls(context));

  const report = JSON.stringify({ budget: CART_CLS_BUDGET, samples });
  // Written whether or not the assertions pass: a green run's numbers are the only way
  // to tell a reserve that is working from one that has quietly stopped being exercised.
  writeFileSync(`${DIR}/cart-cls-unpriced.json`, report);
  // A cart that rendered no lines would trivially score 0 and hide a real regression.
  expect(samples.every((s) => s.lines >= 2), `cart rendered no lines: ${report}`).toBe(true);

  const passing = samples.filter((s) => s.cls <= CART_CLS_BUDGET);
  expect(passing.length, `cart CLS budget: ${report}`).toBeGreaterThanOrEqual(REQUIRED_PASSING);
});

test("cart reserves its totals and its shipping estimate against a priced catalog", async ({ context }) => {
  // The test above runs against the local tree's own 404, where no line is ever priced,
  // so the ZIP-estimate form never un-hides and its reserve is never exercised. That gap
  // is exactly why the cart measured 0.0609 locally and 0.1271 in the field: the local
  // number was missing a whole block. This one supplies prices so both halves run.
  test.setTimeout(180_000);
  const cold = [];
  const warm = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    cold.push(await sampleCartCls(context, { priced: true }));
    warm.push(await sampleCartCls(context, { priced: true, warm: true }));
  }

  const report = JSON.stringify({ CART_CLS_BUDGET, CART_COLD_CLS_BUDGET, cold, warm });
  writeFileSync(`${DIR}/cart-cls-priced.json`, report);
  // A run that lost its prices would take the unpriced path and pass trivially.
  expect([...cold, ...warm].every((s) => s.priced && s.lines >= 2), `catalog did not price the cart: ${report}`).toBe(true);
  expect([...cold, ...warm].every((s) => s.shipForm), `ZIP estimate form never appeared: ${report}`).toBe(true);

  expect(
    cold.filter((s) => s.cls <= CART_COLD_CLS_BUDGET).length,
    `first cart view CLS budget: ${report}`,
  ).toBeGreaterThanOrEqual(REQUIRED_PASSING);
  expect(
    warm.filter((s) => s.cls <= CART_CLS_BUDGET).length,
    `repeat cart view CLS budget: ${report}`,
  ).toBeGreaterThanOrEqual(REQUIRED_PASSING);
});
