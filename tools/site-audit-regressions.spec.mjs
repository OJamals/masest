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

test("newsletter signup keeps a labelled touch-sized email field", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/newsletter.html`, { waitUntil: "domcontentloaded" });

    const email = page.locator("#newsletterForm").getByLabel("Email address");
    await expect(email).toBeVisible();
    const box = await email.boundingBox();
    expect(box?.width, `${viewport.width} email width`).toBeGreaterThanOrEqual(240);
    expect(box?.height, `${viewport.width} email height`).toBeGreaterThanOrEqual(44);
  }
});

test("industry thumbnails expose explicit link names", async ({ page }) => {
  await page.goto(`${BASE_URL}/industries.html`, { waitUntil: "domcontentloaded" });

  const labels = await page.locator(".row-thumb").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
  expect(labels.length).toBeGreaterThanOrEqual(10);
  expect(labels.every(Boolean)).toBe(true);
});

test("core pages keep visible heading levels sequential", async ({ page }) => {
  for (const pagePath of ["index.html", "contact.html?type=quote", "cart.html"]) {
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
  await expect(nav.getByRole("link", { name: "Industries" })).toHaveAttribute("href", "../industries");
  await expect(nav.getByRole("link", { name: "Field Results" })).toHaveAttribute("href", "../proof");

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
      countSelector: ".case-grid .case-card:not([hidden])",
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

    const expectedCount = set.countSelector ? await page.locator(set.countSelector).count() : set.expectedCount;
    expect(result.boxes, `${set.label} media count`).toHaveLength(expectedCount);
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

test("scroll reveal sections become visible on long buyer pages", async ({ page }) => {
  const cases = [
    {
      pagePath: "index.html",
      viewport: { width: 1440, height: 1000 },
      selector: ".section-head.reveal",
      label: "home post-story section",
    },
    {
      pagePath: "index.html",
      viewport: { width: 390, height: 844 },
      selector: ".why-col.reveal",
      label: "home mobile benefit card",
    },
    {
      pagePath: "products.html",
      viewport: { width: 1440, height: 1000 },
      selector: ".swap-finder.reveal",
      label: "product replacement checker",
    },
    {
      pagePath: "product.html?id=hcr",
      viewport: { width: 390, height: 844 },
      selector: ".product-media-row.reveal",
      label: "product proof media",
    },
    {
      pagePath: "services.html",
      viewport: { width: 1440, height: 1000 },
      selector: ".service-data-panel.reveal",
      label: "service data panel",
    },
    {
      pagePath: "services.html",
      viewport: { width: 390, height: 844 },
      selector: ".service-catalog-shell.reveal",
      label: "mobile service catalog",
    },
    {
      pagePath: "resources.html",
      viewport: { width: 1440, height: 1000 },
      selector: ".resources-reference-disclosure .table-scroll.reveal",
      label: "desktop resource comparison table",
      openReference: true,
    },
    {
      pagePath: "resources.html",
      viewport: { width: 390, height: 844 },
      selector: ".resources-reference-disclosure .table-scroll.reveal",
      label: "resource comparison table",
      openReference: true,
    },
    {
      pagePath: "proof.html",
      viewport: { width: 390, height: 844 },
      selector: ".ba-figure.reveal",
      label: "mobile proof before-after card",
    },
  ];

  for (const item of cases) {
    await page.setViewportSize(item.viewport);
    await page.goto(`${BASE_URL}/${item.pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    if (item.openReference) {
      await page.locator(".resources-reference-disclosure summary").click();
      await expect(page.locator(".resources-reference-disclosure")).toHaveJSProperty("open", true);
    }

    const section = page.locator(item.selector).first();
    await section.evaluate((node) => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - Math.round(window.innerHeight * 0.65)));
    });
    await page.waitForTimeout(800);

    const state = await section.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        inClass: node.classList.contains("in"),
        opacity: Number(style.opacity),
        transform: style.transform,
      };
    });

    expect(state.inClass, `${item.label} should receive reveal class`).toBe(true);
    expect(state.opacity, `${item.label} opacity`).toBeGreaterThan(0.85);
    expect(state.transform, `${item.label} transform`).toBe("none");
  }
});

test("cart and product static preview avoid unavailable commerce API", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/products")) apiRequests.push(request.url());
  });

  for (const pagePath of ["cart.html", "product.html?id=hcr"]) {
    await page.goto(`${BASE_URL}/${pagePath}`, { waitUntil: "networkidle" });
  }

  expect(apiRequests).toEqual([]);
});
