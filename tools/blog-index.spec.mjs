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
