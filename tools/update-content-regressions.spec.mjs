import { execFileSync } from "node:child_process";
import { expect, test } from "./playwright-test.mjs";
import { startStaticTestServer } from "./test-static-server.mjs";

let BASE_URL = "";
let staticSite;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  execFileSync(process.execPath, ["tools/cf-build.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: "ignore",
  });
  staticSite = await startStaticTestServer(new URL("../dist/", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ products: [] }),
  }));
  await page.route("**/api/pricing", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      generated_at: "2026-08-21T00:00:00.000Z",
      currency: "usd",
      variants: [],
      services: [],
      pricing_tiers: [],
    }),
  }));
});

test.afterAll(async () => {
  await staticSite?.close();
});

function captureRuntimeIssues(page) {
  const issues = [];
  page.on("console", (message) => {
    if (
      ["error", "warning"].includes(message.type())
      && !message.text().startsWith("Failed to load resource:")
    ) {
      issues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) issues.push(`${response.status()} ${response.url()}`);
  });
  return issues;
}

async function revealEach(locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    await item.scrollIntoViewIfNeeded();
    await expect.poll(
      () => item.evaluate((node) => Number(getComputedStyle(node).opacity)),
      { message: `${label} ${index + 1} opacity` },
    ).toBeGreaterThan(0.85);
  }
}

test("superseded priced bundles stay absent from direct commerce", async ({ page }) => {
  const issues = captureRuntimeIssues(page);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

    await expect(page.locator(".job-plans, .job-plan-card, [data-bundle-sku]"))
      .toHaveCount(0);
    await expect(page.getByRole("link", { name: "Order this kit" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Bundle price");
    await expect(page.locator("main")).not.toContainText("VK-BND-");
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    expect(overflow, `${viewport.width}px page overflow`).toBeLessThanOrEqual(2);
  }

  expect(issues).toEqual([]);
});

test("proof records expose source scope before outcome copy", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });

  const cards = page.locator("[data-proof-card]");
  await expect(cards.first()).toBeVisible();
  await revealEach(cards, "proof record");
  const records = await cards.evaluateAll((nodes) => nodes.map((node) => ({
    type: node.querySelector(".case-eyebrow")?.textContent?.trim() || "",
    scope: node.querySelector(".case-publication")?.textContent?.trim() || "",
  })));

  expect(records.length).toBeGreaterThan(0);
  expect(new Set(records.map(({ type }) => type))).toEqual(new Set(["Customer result", "Product information"]));
  expect(records.every(({ scope }) => scope.length > 0)).toBe(true);
  expect(issues).toEqual([]);
});

test("marine route exposes all eight substantiated products with final packshots", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await page.unroute("**/api/products");
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        sku: "purgo",
        name: "VertKleen Purgo",
        mode: "buy",
        active: true,
        product_variants: [{
          vsku: "MAM-QT",
          label: "1/4 gal (32 oz)",
          gallons: 0.25,
          price: 16.99,
          currency: "usd",
          active: true,
          market: "marine",
          marketing_name: "Marine Antimicrobial",
          sort: 1,
        }],
      }],
    }),
  }));
  await page.goto(`${BASE_URL}/industries/marine.html`, { waitUntil: "networkidle" });

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://masest.co/industries/marine",
  );
  await expect(page.locator(".hero-split > .wrap > .eyebrow")).toContainText("Marine, Marinas & Boatyards");
  await expect(page.locator("h1")).toContainText("Eight marine products for boats, docks, bilges, and boatyards.");
  await expect(page.locator('[data-ind-products]')).toHaveCount(0);
  const marineProducts = page.locator('[data-industry-label-variants="marine"] [data-label-variant]');
  await expect(marineProducts).toHaveCount(8);
  await revealEach(marineProducts, "marine product");
  await expect(marineProducts.locator("img.product-shot")).toHaveCount(8);
  await expect(page.locator('[data-industry-label-variants="marine"]')).toContainText("Pick the right bottle for the job.");
  await expect(page.locator('a', { hasText: "Open marine label PDF" })).toHaveCount(0);
  const antimicrobialCard = page.locator('[data-label-variant="marine-purgo"]');
  await expect(
    antimicrobialCard.getByRole("combobox", { name: "Volume for Marine Antimicrobial" }),
  ).toHaveCount(1);
  await expect(
    antimicrobialCard.getByRole("button", {
      name: /^Add Marine Antimicrobial, .+ to cart$/,
    }),
  ).toHaveCount(1);
  await expect(
    antimicrobialCard.getByRole("link", { name: "Product details" }),
  ).toHaveCount(1);
  const addButton = antimicrobialCard.getByRole("button", {
    name: /^Add Marine Antimicrobial, .+ to cart$/,
  });
  await addButton.click();
  await expect(addButton).toHaveText("Added");
  await expect(page.locator("[data-cart-count]")).toHaveText("1");
  for (const name of [
    "Scale Buster",
    "SeaVap Coil Kleener",
    "Sea Drain Kleener",
    "MultiWash",
    "Marine Degreaser",
    "AlumiBrite",
    "Marine Wash & Wax",
    "Marine Antimicrobial",
  ]) {
    await expect(page.locator('[data-industry-label-variants="marine"]')).toContainText(name);
  }

  const galleryImages = page.locator(".ind-gallery img");
  await revealEach(galleryImages, "marine gallery image");
  const imageState = await galleryImages.evaluateAll((images) => images.map((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
  })));
  expect(imageState.every(({ complete, naturalWidth }) => complete && naturalWidth > 0)).toBe(true);

  await page.goto(`${BASE_URL}/industries.html`, { waitUntil: "networkidle" });
  const marineLinks = await page.getByRole("link", { name: /Marine, Marinas & Boatyards/i })
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(marineLinks.length).toBeGreaterThan(0);
  expect(marineLinks.every((href) => href === "industries/marine")).toBe(true);
  expect(issues).toEqual([]);
});

test("resource room lists only document categories with immediate public downloads", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await page.goto(`${BASE_URL}/resources.html`, { waitUntil: "networkidle" });

  const categories = page.locator("[data-document-category]");
  await expect(categories).toHaveCount(2);
  expect(await categories.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-document-category")))).toEqual([
    "labels",
    "supporting-documents",
  ]);
  await expect(page.getByText(/Request file|Sign in to request/i)).toHaveCount(0);
  await expect(page.locator('[data-document-category="labels"] [data-document-id]')).toHaveCount(16);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="marine"]')).toHaveCount(0);
  await expect(page.locator('a[href*="docs/labels/marine"]')).toHaveCount(0);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="hvac"] [data-document-id]')).toHaveCount(3);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="cip"] [data-document-id]')).toHaveCount(2);
  await revealEach(categories, "document category");
  expect(issues).toEqual([]);
});
