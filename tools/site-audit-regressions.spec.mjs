import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4218;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/products.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => {});
});

test("mobile header keeps logo, sign-in, cart, and menu inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  const boxes = await page.locator(".nav-inner, .nav-logo, .nav-signin, .nav-cart, .nav-burger")
    .evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        className: node.className,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      };
    }).filter((box) => box.visible));

  for (const box of boxes) {
    expect(box.left, `${box.className} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.className} right edge`).toBeLessThanOrEqual(390);
    expect(box.width, `${box.className} width`).toBeGreaterThan(20);
    expect(box.height, `${box.className} height`).toBeGreaterThanOrEqual(44);
  }
});

test("shared chrome keeps one skip link after hydration", async ({ page }) => {
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator('.skip-link[href="#main"]')).toHaveCount(1);
});

test("contact and cart keep visible heading levels sequential", async ({ page }) => {
  for (const pagePath of ["contact.html?type=quote", "cart.html"]) {
    await page.goto(`${BASE_URL}/${pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const skips = await page.locator("h1,h2,h3,h4,h5,h6").evaluateAll((headings) => {
      const visibleLevel = (heading) => {
        const rect = heading.getBoundingClientRect();
        const style = getComputedStyle(heading);
        if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden") return null;
        return {
          level: Number(heading.tagName.slice(1)),
          text: heading.textContent.trim().replace(/\s+/g, " "),
        };
      };
      const visible = headings.map(visibleLevel).filter(Boolean);
      return visible
        .slice(1)
        .map((heading, index) => ({ prev: visible[index], heading }))
        .filter(({ prev, heading }) => heading.level > prev.level + 1);
    });

    expect(skips, `${pagePath} heading skips`).toEqual([]);
  }
});

test("quote request starts as a short lead form and reveals procurement details progressively", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/contact.html?type=quote`, { waitUntil: "domcontentloaded" });

  const visibleRequiredNames = await page.locator("#quoteForm input[required], #quoteForm select[required], #quoteForm textarea[required]")
    .evaluateAll((nodes) => nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((node) => node.name));

  expect(visibleRequiredNames).toEqual(["name", "company", "email", "message"]);
  await expect(page.getByRole("button", { name: /add procurement details/i })).toBeVisible();
  await expect(page.locator("#fVolume")).toBeHidden();

  await page.getByRole("button", { name: /add procurement details/i }).click();
  await expect(page.locator("#fVolume")).toBeVisible();
});

test("mobile pages expose persistent quote and chemical-map actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  const bar = page.locator(".lead-action-bar");
  await expect(bar).toBeHidden();
  await page.mouse.wheel(0, 700);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: /map chemical/i })).toHaveAttribute("href", /type=audit/);
  await expect(bar.getByRole("link", { name: /get quote/i })).toHaveAttribute("href", /type=quote/);
});

test("mobile industry detail pages keep quote and chemical-map actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/industries/plumbing.html`, { waitUntil: "domcontentloaded" });

  const bar = page.locator(".lead-action-bar");
  await expect(bar).toBeHidden();
  await page.mouse.wheel(0, 700);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: /map chemical/i })).toHaveAttribute("href", /type=audit/);
  await expect(bar.getByRole("link", { name: /get quote/i })).toHaveAttribute("href", /type=quote/);
});

test("mobile hamburger menu centers use-case trigger and exposes child links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/industries/plumbing.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#navBurger").click();

  const nav = page.locator("#navLinks");
  const topLevelColors = await page.locator("#navLinks > a, #navLinks summary").evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).color)
  );
  expect(topLevelColors).not.toContain("rgb(255, 255, 255)");

  await page.locator(".nav-group summary").click();
  await expect(nav.getByRole("link", { name: "Industries" })).toHaveAttribute("href", "../industries.html");
  await expect(nav.getByRole("link", { name: "Field Results" })).toHaveAttribute("href", "../proof.html");

  const labelDelta = await page.locator(".nav-group summary").evaluate((node) => {
    const label = node.querySelector(".nav-group-label");
    if (!label) return Number.POSITIVE_INFINITY;
    const labelRect = label.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return Math.abs((labelRect.left + labelRect.width / 2) - (nodeRect.left + nodeRect.width / 2));
  });
  expect(labelDelta).toBeLessThan(2);
});

test("desktop use-case dropdown fits both labels inside the panel", async ({ page }) => {
  await page.setViewportSize({ width: 1140, height: 408 });
  await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".nav-group summary").click();

  const fit = await page.locator(".nav-group .nav-menu").evaluate((menu) => {
    const menuBox = menu.getBoundingClientRect();
    const links = [...menu.querySelectorAll("a")].map((link) => {
      const linkBox = link.getBoundingClientRect();
      return {
        text: link.textContent.trim(),
        visibleWidth: linkBox.width,
        scrollWidth: link.scrollWidth,
      };
    });

    return {
      menuWidth: menuBox.width,
      menuScrollWidth: menu.scrollWidth,
      links,
    };
  });

  expect(fit.menuWidth, "dropdown panel should not clip child links").toBeGreaterThanOrEqual(fit.menuScrollWidth);
  for (const link of fit.links) {
    expect(link.visibleWidth, `${link.text} label should fit its link`).toBeGreaterThanOrEqual(link.scrollWidth);
  }
});

test("mobile home uses original conversion controls without the quick-action switcher", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".home-quick-actions")).toHaveCount(0);
  await expect(page.locator(".lead-action-bar")).toHaveCount(0);
});

test("mobile home hamburger drawer keeps all top-level rows readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#navBurger").click();

  const topLevelColors = await page.locator("#navLinks > a, #navLinks summary").evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).color)
  );
  expect(topLevelColors).not.toContain("rgb(255, 255, 255)");
});

test("proof image sets use uniform media slots", async ({ page }) => {
  const sets = [
    {
      pagePath: "index.html",
      viewport: { width: 1440, height: 900 },
      selector: ".proof-grid .proof-card > figure",
      expectedCount: 3,
      label: "home proof cards",
    },
    {
      pagePath: "proof.html",
      viewport: { width: 1440, height: 900 },
      selector: ".case-grid .case-card > :is(.case-media, .doc-link, .case-ba, img)",
      expectedCount: 12,
      label: "proof case cards",
    },
  ];

  for (const set of sets) {
    await page.setViewportSize(set.viewport);
    await page.goto(`${BASE_URL}/${set.pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const result = await page.locator(set.selector).evaluateAll((nodes) => {
      const boxes = nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const img = node.matches("img") ? node : node.querySelector("img");
          return {
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            src: img?.getAttribute("src") || "",
          };
        })
        .filter((box) => box.width > 80 && box.height > 80);
      const heights = boxes.map((box) => box.height);
      return {
        boxes,
        min: Math.min(...heights),
        max: Math.max(...heights),
      };
    });

    expect(result.boxes, `${set.label} media count`).toHaveLength(set.expectedCount);
    expect(result.max - result.min, `${set.label} media heights: ${JSON.stringify(result.boxes)}`).toBeLessThanOrEqual(3);
  }
});

test("visible content images reserve dimensions on key buyer pages", async ({ page }) => {
  const pages = [
    "products.html",
    "industries.html",
    "proof.html",
    "services.html",
    "industries/plumbing.html",
  ];

  for (const pagePath of pages) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/${pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const missing = await page.locator("img").evaluateAll((images) =>
      images
        .filter((img) => {
          const rect = img.getBoundingClientRect();
          const style = getComputedStyle(img);
          return rect.width > 80 && rect.height > 80 && style.display !== "none" && style.visibility !== "hidden";
        })
        .filter((img) => !img.getAttribute("width") || !img.getAttribute("height"))
        .map((img) => ({
          src: img.getAttribute("src"),
          alt: img.getAttribute("alt"),
        }))
    );

    expect(missing, `${pagePath} visible images missing width/height`).toEqual([]);
  }
});
