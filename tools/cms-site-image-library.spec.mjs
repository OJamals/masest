import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PORT = 4317;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPLACEMENT_IMAGE = new URL("../docs/research/assets/neutral-material-test-patch-v1.webp", import.meta.url).pathname;
let server;
const SITE_IMAGE_COUNT = JSON.parse(
  readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"),
).count;

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
  await expect(page.locator("[data-shared-image-library-count]")).toHaveText(`${SITE_IMAGE_COUNT} images`);
  await expect(page.locator(".shared-image-library-card")).toHaveCount(SITE_IMAGE_COUNT);
  const library = page.locator(".shared-image-library-grid");
  await expect(library).toBeVisible();
  expect(await library.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await page.getByPlaceholder("Search by name or alt text").fill("brewery");
  await expect(page.locator("[data-shared-image-library-count]")).toContainText("image");
  await expect(page.locator(".shared-image-library-card").first()).toBeVisible();
  await page.locator(".shared-image-library-card").first().click();
  await page.getByRole("button", { name: "Select", exact: true }).click();

  await expect.poll(() => page.evaluate(() => window.__imagePickerResult)).not.toBeNull();
  const result = await page.evaluate(() => window.__imagePickerResult);
  expect(result.url).toMatch(/^\/img\//);
  expect(result.alt).toBeTruthy();
});

test("staff previews exact replace-everywhere diff before revision-backed apply", async ({ page }) => {
  await page.goto(`${BASE_URL}/terms.html`);
  await page.evaluate(async () => {
    const { openImageLibraryPicker } = await import("/js/admin/image-library-picker.js");
    const source = {
      storage_path: "cms/old-proof.webp",
      public_url: "/docs/research/assets/cr-hd-degreasing-trial-v1.webp",
      filename: "old-proof.webp",
      alt: "Current proof",
      status: "available",
      source: "cms",
      references: [{
        type: "page_section",
        slug: "home-hero",
        locale: "en",
        title: "Home hero",
        fields: ["payload.image", "seo.og_image"],
      }],
    };
    const target = {
      storage_path: "cms/new-proof.webp",
      public_url: "/docs/research/assets/neutral-material-test-patch-v1.webp",
      filename: "new-proof.webp",
      alt: "Current proof",
      status: "available",
      source: "cms",
    };
    window.__replacementCalls = [];
    const api = async (_path, options = {}) => {
      const body = options.body;
      if (!options.method) return { assets: [source] };
      if (body instanceof FormData) {
        window.__replacementCalls.push("upload");
        return { ok: true, asset: target };
      }
      window.__replacementCalls.push(body?.action || "metadata");
      if (body?.action === "preview_replace_everywhere") {
        return {
          ok: true,
          preview: {
            source,
            target,
            change_count: 1,
            field_count: 2,
            impact_hash: "impact-1",
            changes: [{
              type: "page_section",
              slug: "home-hero",
              locale: "en",
              title: "Home hero",
              status: "published",
              version: 7,
              fields: [
                { path: "payload.image", before: source.public_url, after: target.public_url },
                { path: "seo.og_image", before: source.public_url, after: target.public_url },
              ],
            }],
          },
        };
      }
      if (body?.action === "apply_replace_everywhere") {
        return { ok: true, replaced_entries: 1, replaced_fields: 2, target };
      }
      throw new Error("Unexpected API call");
    };
    openImageLibraryPicker({ api, usage: "page_section", autoOpenLibrary: true, manage: true });
  });

  await page.getByPlaceholder("Search by name or alt text").fill("old-proof");
  await page.locator(".shared-image-library-card").click();
  await page.getByRole("button", { name: "Replace everywhere" }).click();
  await page.locator("[data-shared-image-replace-file]").setInputFiles(REPLACEMENT_IMAGE);

  const diff = page.locator("[data-asset-replacement-diff]");
  await expect(diff).toBeVisible();
  await expect(diff).toContainText("Home hero");
  await expect(diff).toContainText("payload.image");
  await expect(diff).toContainText("seo.og_image");
  await expect(diff).toContainText("Revisions");
  expect(await page.evaluate(() => window.__replacementCalls)).toEqual([
    "upload",
    "preview_replace_everywhere",
  ]);

  await diff.getByRole("button", { name: "Replace in 1 entry" }).click();
  await expect(page.locator("[data-shared-image-status]")).toContainText(
    "Replaced 2 fields in 1 content entry. Roll back from Revisions.",
  );
  expect(await page.evaluate(() => window.__replacementCalls)).toEqual([
    "upload",
    "preview_replace_everywhere",
    "apply_replace_everywhere",
  ]);
});
