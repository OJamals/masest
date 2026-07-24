import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4317;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${BASE_URL}/terms.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

test("platform staff can browse, search, and select existing public-site images", async ({ page }) => {
  await page.goto(`${BASE_URL}/terms.html`);
  await page.evaluate(async () => {
    const { openImageLibraryPicker } = await import("/js/admin/image-library-picker.js");
    window.__imagePickerResult = null;
    openImageLibraryPicker({
      api: async () => ({ assets: [] }),
      usage: "page_section",
    }).then((result) => { window.__imagePickerResult = result; });
  });

  await page.getByRole("button", { name: "Browse library" }).click();
  await expect(page.locator("[data-shared-image-library-count]")).toHaveText("157 images");
  await expect(page.locator(".shared-image-library-card")).toHaveCount(4);

  await page.getByPlaceholder("Search images by name or alt text").fill("brewery");
  await expect(page.locator("[data-shared-image-library-count]")).toContainText("image");
  await expect(page.locator(".shared-image-library-card").first()).toBeVisible();
  await page.locator(".shared-image-library-card").first().getByRole("button", { name: "Use image" }).click();

  await expect.poll(() => page.evaluate(() => window.__imagePickerResult)).not.toBeNull();
  const result = await page.evaluate(() => window.__imagePickerResult);
  expect(result.url).toMatch(/^\/img\//);
  expect(result.alt).toBeTruthy();
});
