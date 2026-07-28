import assert from "node:assert/strict";
import test from "node:test";
import { launchTestBrowser } from "../tools/test-static-server.mjs";

test("test browser fixture closes promptly", { timeout: 10_000 }, async () => {
  const startedAt = performance.now();
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  await page.setContent("<main>Ready</main>");
  await browser.close();

  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 5_000, `browser fixture took ${Math.round(elapsedMs)}ms to close`);
});
