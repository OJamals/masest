import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { test } from "node:test";

const PORT = 4194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function withStaticServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      try {
        const response = await fetch(`${BASE_URL}/index.html`);
        if (response.ok) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
}

test("homepage static preview does not call unavailable api functions", async () => {
  await withStaticServer(async () => {
    const browser = await chromium.launch({ headless: true });
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
    await browser.close();

    assert.deepEqual(badApiResponses, []);
    assert.deepEqual(consoleErrors, []);
  });
});
