import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

let BASE_URL = "";
const ROOT = new URL("..", import.meta.url);

async function withStaticServer(fn) {
  execFileSync(process.execPath, ["tools/cf-build.mjs"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const staticSite = await startStaticTestServer(new URL("../dist/", import.meta.url));
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
      await page.route("https://*.supabase.co/storage/v1/object/public/content-assets/site/img/**", route =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        })
      );

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
      await page.locator(".proof-section").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      assert.deepEqual(badApiResponses, []);
      assert.deepEqual(consoleErrors, []);
      const proofImages = await page.locator(".proof-grid .proof-card img").evaluateAll(images =>
        images.map(image => ({
          src: image.currentSrc,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          hidden: image.hidden,
        }))
      );
      assert.equal(proofImages.length, 2);
      assert.equal(proofImages.every(image =>
        image.src.startsWith("https://mvfxzvkzcqmnwcoblvfc.supabase.co/") &&
        image.complete &&
        image.naturalWidth > 0 &&
        !image.hidden
      ), true);
    } finally {
      await browser.close();
    }
  });
});
