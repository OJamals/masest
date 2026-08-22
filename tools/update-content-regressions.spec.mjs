import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
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

test("priced bundle quote offers stay complete, responsive, and outside direct commerce", async ({ page }) => {
  const issues = captureRuntimeIssues(page);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/products.html`, { waitUntil: "networkidle" });

    const section = page.locator(".job-plans");
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    await expect(section.locator(".job-plan-card")).toHaveCount(5);
    await expect(section.locator("[data-bundle-sku][data-bundle-price-minor]")).toHaveCount(5);
    await expect(section.locator(".job-plan-component")).toHaveCount(20);
    await expect(section.locator(".job-plan-component.is-unresolved")).toHaveCount(0);
    await expect(section.locator(".job-plan-component small")).toHaveCount(20);
    await expect(section.locator(".job-plan-component small").first()).toContainText(/VK-.+-1G · 1 gal jug/);
    await expect(section.getByRole("link", { name: "Order this kit" })).toHaveCount(5);
    await expect(section.locator("img")).toHaveCount(2);
    await expect(section.locator("[data-add-cart], [data-buy], .add-to-cart")).toHaveCount(0);
    await revealEach(section.locator(".job-plan-card"), `${viewport.width}px job plan`);

    const state = await section.evaluate((node) => {
      const links = [...node.querySelectorAll("a")].map((link) => link.getAttribute("href") || "");
      const cards = [...node.querySelectorAll(".job-plan-card")].map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      return {
        viewport: document.documentElement.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links,
        cards,
        text: node.textContent || "",
      };
    });

    expect(state.pageOverflow, `${viewport.width}px page overflow`).toBeLessThanOrEqual(2);
    expect(state.links).toHaveLength(5);
    expect(state.links.every((href) => (
      /^contact\?type=quote&product=VK-BND-[A-Z0-9-]+&message=.*#quoteForm$/.test(href)
    ))).toBe(true);
    expect(state.text).toMatch(/Bundle price[\s\S]*\$54\.00/);
    expect(state.text).toMatch(/Save 1[45]%/);
    expect(state.text).not.toMatch(/add to cart/i);
    for (const card of state.cards) {
      expect(card.left, `${viewport.width}px card left edge`).toBeGreaterThanOrEqual(0);
      expect(card.right, `${viewport.width}px card right edge`).toBeLessThanOrEqual(state.viewport);
    }
    if (viewport.width === 1440) {
      expect(state.cards[3].width).toBeGreaterThan(state.cards[0].width * 1.4);
      expect(Math.abs(state.cards[3].left - state.cards[0].left)).toBeLessThanOrEqual(2);
      expect(Math.abs(state.cards[4].right - state.cards[2].right)).toBeLessThanOrEqual(2);
    }
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

test("marine route exposes the eight approved names and controlled label library", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await page.goto(`${BASE_URL}/industries/marine.html`, { waitUntil: "networkidle" });

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://masest.co/industries/marine",
  );
  await expect(page.locator(".hero-split > .wrap > .eyebrow")).toContainText("Marine, Marinas & Boatyards");
  await expect(page.locator("h1")).toContainText("Eight marine cleaners for boats, docks, bilges, and boatyards.");
  await expect(page.locator('[data-ind-products="hcr-t16 descaler cr2 multiwash crhd alumibrite torque purgo"]')).toHaveCount(1);
  await expect(page.locator("[data-ind-products] .prod-card")).toHaveCount(8);
  await revealEach(page.locator("[data-ind-products] .prod-card"), "marine product");
  const marineLabels = page.locator('[data-industry-label-variants="marine"] [data-label-variant]');
  await expect(marineLabels).toHaveCount(8);
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

test("resource room organizes labels before SDS, TDS, and supporting documents", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await page.goto(`${BASE_URL}/resources.html`, { waitUntil: "networkidle" });

  const categories = page.locator("[data-document-category]");
  await expect(categories).toHaveCount(4);
  expect(await categories.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-document-category")))).toEqual([
    "labels",
    "safety-data-sheets",
    "technical-data-sheets",
    "supporting-documents",
  ]);
  await expect(page.locator('[data-document-category="labels"] [data-document-id]')).toHaveCount(31);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="marine"] [data-document-id]')).toHaveCount(9);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="hvac"] [data-document-id]')).toHaveCount(3);
  await expect(page.locator('[data-document-category="labels"] [data-document-group="cip"] [data-document-id]')).toHaveCount(2);
  await revealEach(categories, "document category");
  expect(issues).toEqual([]);
});
