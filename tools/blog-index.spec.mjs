import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

const PORT = 4332;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const POSTS = JSON.parse(readFileSync(new URL("../data/content/blog.json", import.meta.url), "utf8")).blog_posts;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(`${BASE_URL}/blog.html`);
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

test("blog search and category filters compose and survive reload", async ({ page }) => {
  const target = POSTS.find((post) => post.category !== "news") || POSTS[0];
  await page.goto(`${BASE_URL}/blog.html`);

  const search = page.getByRole("searchbox", { name: "Search articles" });
  await search.fill(target.title);
  await expect(page.locator(".blog-card:visible")).toHaveCount(1);
  await expect(page.locator(".blog-card:visible .blog-card-title")).toHaveText(target.title);

  await page.locator(`[data-filter-cat="${target.category}"]`).click();
  await expect(page.locator("[data-blog-results]")).toHaveText(`1 of ${POSTS.length} articles`);
  await expect(page).toHaveURL(new RegExp(`category=${encodeURIComponent(target.category)}`));
  await expect(page).toHaveURL(/q=/);

  await page.reload();
  await expect(search).toHaveValue(target.title);
  await expect(page.locator(`[data-filter-cat="${target.category}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".blog-card:visible .blog-card-title")).toHaveText(target.title);

  await search.fill("no article can match this phrase");
  await expect(page.locator(".blog-card:visible")).toHaveCount(0);
  await expect(page.locator(".blog-empty")).toBeVisible();
  await expect(page.locator("[data-blog-results]")).toHaveText("No articles match your search");
});

test("blog q links can start a tag-based topic search", async ({ page }) => {
  const target = POSTS.find((post) => Array.isArray(post.tags) && post.tags.includes("descaling"));
  expect(target).toBeTruthy();
  await page.goto(`${BASE_URL}/blog.html?q=descaling`);

  await expect(page.getByRole("searchbox", { name: "Search articles" })).toHaveValue("descaling");
  await expect(page.locator(".blog-card:visible")).toHaveCount(
    POSTS.filter((post) => post.tags?.includes("descaling")).length,
  );
});

test("blog index keeps a first reading entry visible at desktop width and avoids mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 674 });
  await page.goto(`${BASE_URL}/blog.html`);

  await expect(page.locator("[data-blog-start-here]")).toBeVisible();
  const firstCard = page.locator(".blog-card").first();
  await expect(firstCard).toBeVisible();
  const firstCardBox = await firstCard.boundingBox();
  expect(firstCardBox).toBeTruthy();
  expect(firstCardBox.y).toBeLessThan(674);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const overflow = await page.locator("html").evaluate((root) => root.scrollWidth > root.clientWidth);
  expect(overflow).toBe(false);
});

test("post TOC is collapsed by default, keyboard operable, and comparison packshots retain bounds", async ({ page }) => {
  await page.goto(`${BASE_URL}/blog/hmis-000-explained.html`);
  const toc = page.locator("details.blog-toc");
  await expect(toc).toBeVisible();
  await expect(toc).not.toHaveAttribute("open", "");

  const summary = toc.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(toc).toHaveAttribute("open", "");
  await expect(toc.getByRole("link").first()).toBeVisible();

  await page.goto(`${BASE_URL}/blog.html`);
  const packshot = page.locator(".blog-card-img--comparison").first();
  await expect(packshot).toBeVisible();
  await expect(packshot).toHaveCSS("object-fit", "cover");
  await expect(packshot).toHaveCSS("padding", "0px");
  await expect(packshot).toHaveCSS("aspect-ratio", "4 / 3");
  const bounds = await packshot.boundingBox();
  const cardBounds = await packshot.locator("xpath=ancestor::article").boundingBox();
  expect(bounds).toBeTruthy();
  expect(cardBounds).toBeTruthy();
  expect(bounds.width).toBeLessThanOrEqual(cardBounds.width);
  expect(bounds.height).toBeLessThanOrEqual(cardBounds.height);

  const comparisons = POSTS.filter((post) => post.hero?.includes("/blog/comparisons/"));
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 844 });
    for (const post of comparisons) {
      await page.goto(`${BASE_URL}/blog/${post.slug}.html`);
      const frame = page.locator(".blog-hero-media--comparison");
      const image = frame.locator("img");
      await expect(frame).toHaveCSS("padding", "0px");
      await expect(image).toHaveCSS("object-fit", "cover");
      const frameBounds = await frame.boundingBox();
      const imageBounds = await image.boundingBox();
      expect(imageBounds.width).toBeCloseTo(frameBounds.width, 0);
      expect(imageBounds.height).toBeCloseTo(frameBounds.height, 0);
      expect(imageBounds.width / imageBounds.height).toBeCloseTo(4 / 3, 2);
    }
  }
});
