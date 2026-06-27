import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4225;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = "output/playwright/cms-mature";
let server;

test.beforeAll(async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([
    exitedOnce,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

async function bootAsStaff(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
  await page.route("**/data/content/manifest.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      generated_at: "2026-06-26T12:00:00Z",
      files: {
        "services.json": {
          count: 2,
          counts: { services: 1, service_packages: 1 },
          sha256: "a".repeat(64),
        },
        "proof.json": {
          count: 1,
          counts: { proof_cards: 1 },
          sha256: "b".repeat(64),
        },
      },
    }),
  }));
  await page.route("**/api/admin/content-assets**", async (route) => {
    if (route.request().method() === "POST") {
      const isJson = (route.request().headers()["content-type"] || "").includes("application/json");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          asset: {
            storage_path: isJson ? "img/proof/cases/registered-brewery.webp" : "cms/proof/uploaded-brewery.webp",
            public_url: isJson ? "img/proof/cases/registered-brewery.webp" : "cms/proof/uploaded-brewery.webp",
            alt: isJson ? "Registered brewery proof image" : "Uploaded brewery proof image",
            status: "available",
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assets: [{
          storage_path: "img/proof/cases/brewery.webp",
          public_url: "img/proof/cases/brewery.webp",
          alt: "Brewery tank cleaned with VertKleen CR and HCR",
          status: "available",
          credit: "MASEST field team",
        }],
      }),
    });
  });
  await page.route("**/api/admin/content-revisions**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      revisions: [{
        version: 2,
        status: "draft",
        note: "Draft saved",
        created_at: "2026-06-25T12:00:00Z",
      }],
    }),
  }));
  await page.route(/\/api\/admin\/content(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status") || "published";
    const workflowEntry = {
      type: "proof_card",
      slug: "brewery-cip",
      title: "Brewery CIP",
      status: "in_review",
      locale: "en",
      payload: {
        kind: "food",
        image: "img/proof/cases/brewery.webp",
        image_alt: "Brewery tank cleaned with VertKleen CR and HCR",
        result: "Matched legacy CIP sequence.",
      },
      seo: {},
      updated_at: "2026-06-25T12:00:00Z",
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: status === "all" ? [workflowEntry] : [] }),
    });
  });
}

test("cms editor supports preview, revision history, workflow, and asset picker", async ({ page }) => {
  await bootAsStaff(page);
  await page.goto(`${BASE_URL}/admin.html#content`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator("#contentStructuredFields")).toBeVisible();
  await expect(page.locator("#contentPreviewFrame")).toBeVisible();
  await expect(page.locator("#contentRevisionList")).toBeVisible();
  await expect(page.locator("#contentWorkflowQueue")).toBeVisible();
  await expect(page.locator("#contentStatusFilter")).toHaveValue("published");
  await expect(page.locator("#contentList")).toContainText("No content entries");
  await expect(page.locator("#contentWorkflowRows")).toContainText("Brewery CIP");
  await expect(page.locator("#contentManifestRows")).toContainText("services.json");
  await expect(page.locator("#contentManifestRows")).toContainText("services: 1");
  await expect(page.locator("#contentManifestRows")).toContainText("service packages: 1");

  await page.locator("#contentWorkflowRows [data-content-edit]").first().click();
  await expect(page.locator('[data-content-payload-field="image"]')).toBeVisible();
  await page.locator('[data-content-payload-field="image_alt"]').fill("");
  await page.locator('[data-content-action="asset"][data-content-asset-target="image"]').click();
  await expect(page.locator("#contentAssetPicker")).toBeVisible();
  await expect(page.locator("#contentAssetSearch")).toBeVisible();
  await expect(page.locator("#contentAssetStatusFilter")).toHaveValue("available");
  await page.locator("#contentAssetSearch").fill("brewery");
  await page.locator('[data-content-action="refresh_assets"]').click();
  await expect(page.locator("#contentAssetRows")).toContainText("MASEST field team");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-asset-manager.png`, fullPage: true });
  await page.locator("[data-content-asset-path]").first().click();
  await expect(page.locator('[data-content-payload-field="image"]')).toHaveValue("img/proof/cases/brewery.webp");
  await expect(page.locator('[data-content-payload-field="image_alt"]')).toHaveValue("Brewery tank cleaned with VertKleen CR and HCR");

  await page.locator('[data-content-action="asset"][data-content-asset-target="image"]').click();
  await page.locator("#contentAssetPath").fill("img/proof/cases/registered-brewery.webp");
  await page.locator("#contentAssetPathAlt").fill("Registered brewery proof image");
  await page.locator("#contentAssetCredit").fill("MASEST archive");
  await page.locator('[data-content-action="register_asset"]').click();
  await expect(page.locator('[data-content-payload-field="image"]')).toHaveValue("img/proof/cases/registered-brewery.webp");
  await expect(page.locator('[data-content-payload-field="image_alt"]')).toHaveValue("Registered brewery proof image");
  await expect(page.locator("#contentStatus")).toHaveText("Asset registered.");

  await page.locator('[data-content-payload-field="image_alt"]').fill("Stale alt from prior image");
  await page.locator('[data-content-action="asset"][data-content-asset-target="image"]').click();
  await page.locator("#contentAssetFile").setInputFiles({
    name: "uploaded-brewery.webp",
    mimeType: "image/webp",
    buffer: Buffer.from("stub-webp"),
  });
  await page.locator("#contentAssetAlt").fill("Uploaded brewery proof image");
  await page.locator('[data-content-action="upload_asset"]').click();
  await expect(page.locator('[data-content-payload-field="image"]')).toHaveValue("cms/proof/uploaded-brewery.webp");
  await expect(page.locator('[data-content-payload-field="image_alt"]')).toHaveValue("Uploaded brewery proof image");
  await expect(page.locator("#contentStatus")).toHaveText("Asset uploaded.");

  await page.locator('[data-content-action="preview"]').click();
  await expect(page.frameLocator("#contentPreviewFrame").locator("h1")).toContainText("Brewery CIP");
  await page.locator("#admContent").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-content-desktop.png`, fullPage: true });
});

test("public pages render category-filtered CMS FAQs", async ({ page }) => {
  await page.route("**/data/content/faqs.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      faq_blocks: [
        {
          slug: "service-scope",
          category: "services",
          question: "How are service line items scoped?",
          answer: "MASEST confirms sample type, site access, deliverables, and schedule before work starts.",
        },
        {
          slug: "sds-request",
          category: "resources",
          question: "Where do SDS requests go?",
          answer: "Document requests route through the resource and quote intake path.",
        },
      ],
    }),
  }));

  await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-cms-content="faq_blocks"] details')).toHaveCount(1);
  await expect(page.locator('[data-cms-content="faq_blocks"]')).toContainText("How are service line items scoped?");
  await expect(page.locator('[data-cms-content="faq_blocks"]')).not.toContainText("Where do SDS requests go?");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/public-services-cms-faqs.png`, fullPage: true });

  await page.goto(`${BASE_URL}/resources.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-cms-content="faq_blocks"] details')).toHaveCount(1);
  await expect(page.locator('[data-cms-content="faq_blocks"]')).toContainText("Where do SDS requests go?");
  await expect(page.locator('[data-cms-content="faq_blocks"]')).not.toContainText("How are service line items scoped?");
});

test("public industry CMS cards render managed images", async ({ page }) => {
  await page.route("**/data/content/industries.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      industry_cards: [{
        slug: "cold-storage",
        category: "Distribution",
        title: "Cold storage",
        href: "industries/distribution-cold-storage",
        image: "img/proof/cases/fire-pump.webp",
        image_alt: "Cold storage condenser cleaned with VertKleen",
        summary: "Refrigeration maintenance proof for facilities teams.",
      }],
    }),
  }));

  await page.goto(`${BASE_URL}/industries.html`, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-cms-content="industry_cards"] .route-card-media-card');
  await expect(card).toHaveAttribute("href", "industries/distribution-cold-storage");
  await expect(card.locator("img")).toHaveAttribute("alt", "Cold storage condenser cleaned with VertKleen");
  await expect(card).toContainText("Cold storage");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/public-industries-cms-image-card.png`, fullPage: true });
});

for (const pagePath of ["/services.html", "/proof.html", "/resources.html", "/industries.html"]) {
  test(`public page has no horizontal overflow: ${pagePath}`, async ({ page }) => {
    await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/public-${pagePath.replace(/[^a-z0-9]+/gi, "-")}.png`, fullPage: true });
  });
}
