import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const ROOT = new URL("..", import.meta.url);

test("resources document categories use library spacing instead of public section padding", async () => {
  const site = await startStaticTestServer(ROOT);
  const browser = await launchTestBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  try {
    await page.goto(`${site.baseUrl}/resources.html#doc-category-labels`, { waitUntil: "load" });

    const metrics = await page.evaluate(() => {
      const categories = [...document.querySelectorAll(".doc-lib-category")];
      return categories.map((category, index) => {
        const style = getComputedStyle(category);
        const grid = category.querySelector(".doc-lib-category-grid");
        const nextHead = categories[index + 1]?.querySelector(".doc-lib-category-head");
        return {
          name: category.getAttribute("data-document-category"),
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          gapToNext: grid && nextHead
            ? Math.round(nextHead.getBoundingClientRect().top - grid.getBoundingClientRect().bottom)
            : null,
        };
      });
    });

    assert.ok(metrics.length >= 4, "expected labels, SDS, TDS, and supporting-document categories");
    for (const metric of metrics) {
      assert.equal(metric.paddingTop, "0px", `${metric.name} should not inherit public section top padding`);
      assert.equal(metric.paddingBottom, "0px", `${metric.name} should not inherit public section bottom padding`);
      if (metric.gapToNext !== null) {
        assert.ok(
          metric.gapToNext >= 28 && metric.gapToNext <= 56,
          `${metric.name} should hand off to the next document category without a dead band; got ${metric.gapToNext}px`,
        );
      }
    }
  } finally {
    await context.close();
    await browser.close();
    await site.close();
  }
});
