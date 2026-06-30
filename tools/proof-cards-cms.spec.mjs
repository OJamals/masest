// Contract spec for the proof_card CMS migration: proof.html mounts
// data-cms-content="proof_cards" (replace mode) over the hardcoded case cards.
// A published snapshot replaces the fallback; cards with an href render the PDF
// doc-link wrapper + badge, others a plain figure; sort_order drives order; an
// empty snapshot leaves the hardcoded cards intact.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4274;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIR = "output/playwright/proof-cms";
let server;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${BASE_URL}/proof.html`).catch(() => null);
    if (r?.ok) return;
    await new Promise((res) => setTimeout(res, 125));
  }
  throw new Error("static server did not start");
});
test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
});

const PROOF = {
  proof_cards: [
    { slug: "second-card", title: "Second card", eyebrow: "B", kind: "food", result: "Result B", image: "img/proof/cases/brewery.webp", image_alt: "B", chips: ["x"], source: "Source: B", sort_order: 2 },
    { slug: "doc-card", title: "Doc card", eyebrow: "A", kind: "hvac", result: "Result A", image: "img/proof/cases/ddc-rust.webp", image_alt: "A", chips: ["y"], source: "Source: A", href: "docs/example.pdf", sort_order: 1 },
  ],
};

test("published proof_cards replace the hardcoded fallback on proof.html", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(PROOF),
  }));
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });

  const grid = page.locator('.case-grid[data-cms-content="proof_cards"]');
  await expect(grid.locator(".case-card")).toHaveCount(2);
  // sort_order: the href card (sort_order 1) renders first.
  await expect(grid.locator(".case-card").first()).toContainText("Doc card");
  // The href card gets a doc-link wrapper + a PDF badge; the other does not.
  await expect(grid.locator('a.doc-link[href="docs/example.pdf"]')).toHaveCount(1);
  await expect(grid.locator(".doc-badge")).toHaveCount(1);
  await expect(grid.locator(".case-card", { hasText: "Second card" }).locator("a.doc-link")).toHaveCount(0);
  await expect(grid.locator(".case-card", { hasText: "Second card" }).locator("figure.case-media")).toHaveCount(1);
  // The hardcoded fallback (the DDC rust hero card) is gone under replace mode.
  await expect(grid.getByText("cleared in 30 minutes", { exact: false })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, "proof.html must not overflow horizontally with CMS cards").toBeFalsy();
});

test("a proof_card with image_after renders a before/after .case-ba pair", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      proof_cards: [{
        slug: "ba-card", title: "Before/after card", eyebrow: "BA", kind: "facility",
        result: "Cleared.", image: "img/proof/cases/grout-before.webp", image_alt: "Before, soiled",
        image_w: 934, image_h: 700,
        image_after: "img/proof/cases/grout-after.webp", image_after_alt: "After, clean",
        image_after_w: 850, image_after_h: 882, sort_order: 1,
      }],
    }),
  }));
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });
  const card = page.locator('.case-grid[data-cms-content="proof_cards"] .case-card', { hasText: "Before/after card" });
  // Two-figure pair, not the single doc-link/figure media.
  await expect(card.locator(".case-ba")).toHaveCount(1);
  await expect(card.locator(".case-ba figure")).toHaveCount(2);
  await expect(card.locator('img[src="img/proof/cases/grout-before.webp"]')).toHaveCount(1);
  await expect(card.locator('img[src="img/proof/cases/grout-after.webp"]')).toHaveCount(1);
  await expect(card.locator(".case-ba")).toContainText("Before");
  await expect(card.locator(".case-ba")).toContainText("After");
  await expect(card.locator("a.doc-link")).toHaveCount(0);
});

test("empty proof snapshot leaves the hardcoded case cards intact", async ({ page }) => {
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ proof_cards: [] }),
  }));
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });
  const grid = page.locator('.case-grid[data-cms-content="proof_cards"]');
  await expect(grid.getByText("cleared in 30 minutes", { exact: false })).toBeVisible();
  await expect(grid.locator(".case-card")).toHaveCount(14);
});
