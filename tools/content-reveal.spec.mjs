// Regression: CMS public content is injected after initReveal() runs at
// DOMContentLoaded, so the scroll-reveal IntersectionObserver never observed
// the injected `.reveal` nodes. Under real network latency (snapshot fetch
// slower than the 250ms one-shot reveal timer), a CMS page_section/card in the
// initial viewport stayed opacity:0 for motion-enabled users until they
// scrolled. initContentSnapshots() now re-runs initReveal() after injecting.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4231;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/contact.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit").catch(() => {});
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  server.kill("SIGKILL");
});

const FIXTURE = {
  page_sections: [{
    slug: "reveal-regression",
    title: "Reveal regression band",
    page: "contact",
    region: "body",
    headline: "CMS reveal regression band",
    body: "Must be visible to motion-enabled users without scrolling.",
    active: true,
    sort_order: 1,
  }],
};

// Tall viewport so the bottom page_section mount sits in the initial viewport
// without any scroll; motion enabled (no reducedMotion override).
test.use({ viewport: { width: 1280, height: 5200 } });

test("injected CMS section becomes visible without scrolling despite slow snapshot fetch", async ({ page }) => {
  await page.route("**/data/content/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    const body = file === "page-sections.json" ? JSON.stringify(FIXTURE) : "{}";
    // Simulate CDN latency that loses the race against the 250ms one-shot timer.
    await new Promise((resolve) => setTimeout(resolve, 600));
    route.fulfill({ status: 200, contentType: "application/json", body });
  });

  await page.goto(`${BASE_URL}/contact.html`, { waitUntil: "domcontentloaded" });
  const section = page.locator(".cms-page-section");
  // No scroll performed anywhere in this test.
  await expect(section).toHaveClass(/\bin\b/, { timeout: 5000 });
  await expect(section).toHaveCSS("opacity", "1");
});
