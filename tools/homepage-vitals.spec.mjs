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
