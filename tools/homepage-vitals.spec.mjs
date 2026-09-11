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
import { mkdirSync } from "node:fs";
import { test, expect } from "./playwright-test.mjs";
import { startStaticTestServer } from "./test-static-server.mjs";

const DIR = "output/playwright/homepage-vitals";
const LCP_BUDGET_MS = 2500;
const CLS_BUDGET = 0.01;
// The cart cannot reach the homepage's 0.01, and the reason is worth stating precisely
// rather than hand-waving as "some residual". With the reserve in place the skeleton rows
// are exact -- measured per-line delta on hydration is 0px at every viewport tried. What
// still moves is the order summary, which grows 539 -> 761px (+222px) when #cartEstimate
// and the ZIP-estimate form un-hide once real prices arrive. Those two cannot be reserved
// from localStorage alone: one needs prices, the other needs to know whether the cart
// consolidates into a single carton. Measured 0.0609 with very low variance
// (0.06089/0.06089/0.06075), so 0.08 is headroom over a deterministic number, not a guess.
// Against 0.4967 (iPad Mini) / 0.4796 (Pixel 7) / 0.5578 (three lines) before the fix.
// Reserving the summary block is the named follow-up.
const CART_CLS_BUDGET = 0.08;
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
async function sampleCartCls(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.route("**/api/products*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, CART_CATALOG_DELAY_MS));
    // continue, never fulfil: substituting a body detaches the request from real
    // conditions, which is how a 48KB and a 127KB image once scored identically.
    await route.continue();
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
  await page.evaluate(() =>
    localStorage.setItem("masest_cart", JSON.stringify({ "CRCIP-1G": 2, "HCRCIP-25G": 1 })),
  );
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
  // A cart that rendered no lines would trivially score 0 and hide a real regression.
  expect(samples.every((s) => s.lines >= 2), `cart rendered no lines: ${report}`).toBe(true);

  const passing = samples.filter((s) => s.cls <= CART_CLS_BUDGET);
  expect(passing.length, `cart CLS budget: ${report}`).toBeGreaterThanOrEqual(REQUIRED_PASSING);
});
