import assert from "node:assert/strict";
import { test } from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";

async function withStaticServer(fn) {
  const staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

test("homepage static preview does not call unavailable api functions", async () => {
  await withStaticServer(async () => {
    const browser = await launchTestBrowser({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const badApiResponses = [];
      const consoleErrors = [];

      page.on("response", response => {
        const url = response.url();
        if (response.status() >= 400 && /\/api\/(track|products)\b/.test(url)) {
          badApiResponses.push(`${response.status()} ${response.request().method()} ${url}`);
        }
      });
      page.on("console", message => {
        if (message.type() === "error" && /api\/(track|products)/.test(message.text())) {
          consoleErrors.push(message.text());
        }
      });

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      assert.deepEqual(badApiResponses, []);
      assert.deepEqual(consoleErrors, []);
    } finally {
      await browser.close();
    }
  });
});
