// Contract spec for the proof_card CMS migration: proof.html mounts
// data-cms-content="proof_cards" (replace mode) over the hardcoded case cards.
// A published snapshot replaces the fallback; photos stay on-page while the
// approved narrative and result-summary label render in a native disclosure.
// Legacy href values never expose source documents. sort_order drives order; an
// empty snapshot leaves the hardcoded cards intact.
import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

const DIR = "output/playwright/proof-cms";
let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});
test.afterAll(async () => {
  await staticSite?.close();
});

const PROOF = {
  proof_cards: [
    {
      slug: "second-card",
      title: "Second card",
      eyebrow: "B",
      kind: "food",
      result: "Result B",
      narrative: "Narrative B",
      publication_scope: "Published result summary",
      image: "img/proof/cases/brewery.webp",
      image_alt: "B",
      chips: ["x"],
      source: "Source: B",
      sort_order: 2,
    },
    {
      slug: "doc-card",
      title: "Doc card",
      eyebrow: "A",
      kind: "hvac",
      result: "Result A",
      narrative: "Narrative A",
      publication_scope: "Published result summary",
      image: "img/proof/cases/ddc-rust.webp",
      image_alt: "A",
      chips: ["y"],
      source: "Source: A",
      href: "docs/example.pdf",
      sort_order: 1,
    },
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
  // sort_order: the legacy-href card (sort_order 1) renders first.
  await expect(grid.locator(".case-card").first()).toContainText("Doc card");
  // Source files are never exposed from a proof card, including stale CMS rows.
  await expect(grid.locator('a[href="docs/example.pdf"]')).toHaveCount(0);
  await expect(grid.locator(".doc-link, .doc-badge")).toHaveCount(0);
  await expect(grid.locator("figure.case-media")).toHaveCount(2);

  const firstCard = grid.locator(".case-card").first();
  const disclosure = firstCard.locator("details.case-disclosure");
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(disclosure.locator("summary")).toHaveText("View result details");
  await expect(disclosure).toContainText("Narrative A");
  await expect(firstCard.locator(".case-publication")).toHaveText("Published result summary");
  await disclosure.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");

  await expect(grid.locator(".case-card", { hasText: "Second card" }).locator("figure.case-media")).toHaveCount(1);
  // The hardcoded fallback (the DDC rust hero card) is gone under replace mode.
  await expect(grid.getByText("cleared in 30 minutes", { exact: false })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, "proof.html must not overflow horizontally with CMS cards").toBeFalsy();
});

test("proof-card hashes remain targeted after the CMS snapshot replaces fallback cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const hashProof = {
    proof_cards: [
      PROOF.proof_cards[1],
      ...Array.from({ length: 6 }, (_, index) => ({
        ...PROOF.proof_cards[0],
        slug: `filler-card-${index}`,
        title: `Filler card ${index}`,
        sort_order: index + 2,
      })),
    ],
  };
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(hashProof),
  }));
  await page.goto(`${BASE_URL}/proof.html#doc-card`, { waitUntil: "networkidle" });

  const card = page.locator("#doc-card");
  await expect(page.locator(".nav")).toBeVisible();
  await expect(card).toBeVisible();
  const { cardTop, navBottom } = await page.evaluate(() => ({
    cardTop: document.querySelector("#doc-card")?.getBoundingClientRect().top ?? -1,
    navBottom: document.querySelector(".nav")?.getBoundingClientRect().bottom ?? 0,
  }));
  expect(navBottom).toBeGreaterThanOrEqual(44);
  expect(cardTop).toBeGreaterThanOrEqual(navBottom);
  expect(cardTop).toBeLessThan(844);
});

test("a proof_card with image_after renders a before/after .case-ba pair", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      proof_cards: [{
        slug: "ba-card", title: "Before/after card", eyebrow: "BA", kind: "facility",
        result: "Cleared.", image: "img/proof/cases/grout-before.webp", image_alt: "Before, soiled",
        narrative: "Matched-angle images record the visible sequence.",
        publication_scope: "Published result summary",
        image_w: 934, image_h: 700,
        image_after: "img/proof/cases/grout-after.webp", image_after_alt: "After, clean",
        image_after_w: 850, image_after_h: 882, sort_order: 1,
      }],
    }),
  }));
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });
  const card = page.locator('.case-grid[data-cms-content="proof_cards"] .case-card', { hasText: "Before/after card" });
  // Two-figure pair, not the single-image media.
  await expect(card.locator(".case-ba")).toHaveCount(1);
  await expect(card.locator(".case-ba figure")).toHaveCount(2);
  await expect(card.locator(".case-ba img").first()).toHaveAttribute(
    "src",
    /\/img\/proof\/cases\/grout-before\.webp/,
  );
  await expect(card.locator(".case-ba img").last()).toHaveAttribute(
    "src",
    /\/img\/proof\/cases\/grout-after\.webp/,
  );
  await expect(card.locator(".case-ba")).toContainText("Before");
  await expect(card.locator(".case-ba")).toContainText("After");
  await expect(card.locator("a.doc-link")).toHaveCount(0);
  await expect(card.locator("details.case-disclosure")).toContainText("Matched-angle images record the visible sequence.");
});

test("empty proof snapshot leaves the hardcoded case cards intact", async ({ page }) => {
  await page.route("**/data/content/proof.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ proof_cards: [] }),
  }));
  await page.goto(`${BASE_URL}/proof.html`, { waitUntil: "networkidle" });
  const grid = page.locator('.case-grid[data-cms-content="proof_cards"]');
  await expect(grid.getByText("Rust-and-scale removal", { exact: true })).toBeVisible();
  await expect(grid.locator(".case-card")).toHaveCount(12);
});
