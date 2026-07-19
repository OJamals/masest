import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4218;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.use({ channel: "chrome" });
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

test("footer legal links keep touch-sized hit areas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/dashboard.html#orders`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const legalLinks = await page.locator(".foot-legal a").evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      text: node.textContent.trim(),
      height: Math.round(rect.height),
      display: style.display,
      alignItems: style.alignItems,
    };
  }));

  expect(legalLinks.map((link) => link.text)).toEqual(["Privacy", "Terms", "EULA"]);
  for (const link of legalLinks) {
    expect(link.height, `${link.text} footer link height`).toBeGreaterThanOrEqual(44);
    expect(link.display, `${link.text} footer link display`).toBe("flex");
    expect(link.alignItems, `${link.text} footer link alignment`).toBe("center");
  }
});

test("post-auth notification bubbles sit outside tab button corners", async ({ page }) => {
  const measureBadge = async (selector) => page.locator(selector).evaluate((badge) => {
    badge.hidden = false;
    badge.textContent = "2";
    const button = badge.closest("button");
    const badgeRect = badge.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const style = getComputedStyle(badge);
    return {
      badgeTop: Math.round(badgeRect.top),
      badgeRight: Math.round(badgeRect.right),
      buttonTop: Math.round(buttonRect.top),
      buttonRight: Math.round(buttonRect.right),
      position: style.position,
      marginLeft: style.marginLeft,
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/dashboard.html#notifications`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.getElementById("dashGuest").hidden = true;
    document.getElementById("dashApp").hidden = false;
  });
  await expect(page.locator("#badgeNotifs")).toBeHidden();
  const dashboard = await measureBadge("#badgeNotifs");
  expect(dashboard.position).toBe("absolute");
  expect(dashboard.badgeTop, "dashboard badge top edge").toBeLessThan(dashboard.buttonTop);
  expect(dashboard.badgeRight, "dashboard badge right edge").toBeGreaterThan(dashboard.buttonRight);
  expect(dashboard.marginLeft, "dashboard badge should not consume label space").toBe("0px");

  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.getElementById("admGate").hidden = true;
    document.getElementById("admApp").hidden = false;
  });
  await page.locator("#admNavToggle").click();
  await expect(page.locator("#aBadgePending")).toBeHidden();
  await expect(page.locator("#aBadgeCrm")).toBeHidden();
  const admin = await measureBadge("#aBadgeQuotes");
  expect(admin.position).toBe("absolute");
  expect(admin.badgeTop, "admin badge top edge").toBeLessThan(admin.buttonTop);
  expect(admin.badgeRight, "admin badge right edge").toBeGreaterThan(admin.buttonRight);
  expect(admin.marginLeft, "admin badge should not consume label space").toBe("0px");
});

test("blog category chips keep touch-sized filter controls", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/blog.html`, { waitUntil: "domcontentloaded" });

    const chips = await page.locator(".blog-chip").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        text: node.textContent.trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: style.display,
        alignItems: style.alignItems,
      };
    }));

    expect(chips.length, `${viewport.width} blog chip count`).toBeGreaterThanOrEqual(4);
    for (const chip of chips) {
      expect(chip.height, `${viewport.width} ${chip.text} chip height`).toBeGreaterThanOrEqual(44);
      expect(chip.width, `${viewport.width} ${chip.text} chip width`).toBeGreaterThan(44);
      expect(chip.display, `${viewport.width} ${chip.text} chip display`).toBe("flex");
      expect(chip.alignItems, `${viewport.width} ${chip.text} chip alignment`).toBe("center");
    }
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

test("quote request starts as a short lead form and reveals product details progressively", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: /add product, volume & timeline/i })).toBeVisible();
  await expect(page.locator("#fVolume")).toBeHidden();

  await page.getByRole("button", { name: /add product, volume & timeline/i }).click();
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

  const quoteBox = await bar.getByRole("link", { name: /get quote/i }).boundingBox();
  expect(quoteBox?.y, "quote action top edge").toBeGreaterThanOrEqual(0);
  expect((quoteBox?.y || 0) + (quoteBox?.height || 0), "quote action bottom edge").toBeLessThanOrEqual(844);
});

test("mobile customer chat follows registered lead-bar obstruction state", async ({ page }) => {
  await page.addInitScript(() => {
    window.__testIntersectionObservers = [];
    window.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.targets = [];
        window.__testIntersectionObservers.push(this);
      }

      observe(target) {
        this.targets.push(target);
      }

      disconnect() {}
      unobserve() {}
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  const bar = page.locator(".lead-action-bar");
  const chat = page.locator(".customer-chat");
  const launcher = page.locator(".customer-chat__toggle");
  await launcher.waitFor();
  await expect(bar).toHaveAttribute("data-customer-chat-obstruction", "");
  await expect(bar).toHaveAttribute("data-customer-chat-obstruction-active", "false");
  await expect.poll(() => chat.evaluate((node) => node.style.getPropertyValue("--customer-chat-avoid"))).toBe("0px");

  const activation = await page.evaluate(async () => {
    const sentinel = document.querySelector(".lead-action-sentinel");
    const observer = window.__testIntersectionObservers.find(({ targets }) => targets.includes(sentinel));
    const originalFrame = window.requestAnimationFrame;
    let events = 0;
    let frames = 0;
    const onChange = () => { events += 1; };
    document.addEventListener("masest:customer-chat-obstruction-change", onChange);
    window.requestAnimationFrame = (callback) => {
      frames += 1;
      return originalFrame.call(window, callback);
    };
    observer.callback([{ target: sentinel, isIntersecting: false }]);
    observer.callback([{ target: sentinel, isIntersecting: false }]);
    await new Promise((resolve) => originalFrame.call(window, () => originalFrame.call(window, resolve)));
    window.requestAnimationFrame = originalFrame;
    document.removeEventListener("masest:customer-chat-obstruction-change", onChange);
    return { events, frames };
  });

  expect(activation).toEqual({ events: 1, frames: 1 });
  await expect(bar).toHaveAttribute("data-customer-chat-obstruction-active", "true");
  await expect(bar).toBeVisible();

  const expectNoLauncherOverlap = async (state) => {
    const [barBox, launcherBox] = await Promise.all([bar.boundingBox(), launcher.boundingBox()]);
    expect(barBox, `${state} lead bar box`).not.toBeNull();
    expect(launcherBox, `${state} launcher box`).not.toBeNull();
    expect(
      launcherBox.y + launcherBox.height <= barBox.y || launcherBox.y >= barBox.y + barBox.height,
      `${state} launcher must not overlap lead bar`,
    ).toBe(true);
  };

  await expectNoLauncherOverlap("closed");
  await bar.evaluate((node) => { node.style.height = "160px"; });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => chat.evaluate((node) => Number.parseFloat(node.style.getPropertyValue("--customer-chat-avoid")))).toBeGreaterThan(0);
  await expectNoLauncherOverlap("resized");
  await bar.evaluate((node) => { node.style.removeProperty("height"); });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect.poll(() => chat.evaluate((node) => node.style.getPropertyValue("--customer-chat-avoid"))).toBe("0px");

  await launcher.click();
  await expect(page.locator(".customer-chat__panel")).toBeVisible();
  await expectNoLauncherOverlap("open");

  await page.evaluate(() => {
    const shop = document.querySelector("#shopGrid");
    const observer = window.__testIntersectionObservers.find(({ targets }) => targets.includes(shop));
    observer.callback([{ target: shop, isIntersecting: true }]);
  });
  await expect(bar).toHaveAttribute("data-customer-chat-obstruction-active", "false");
  await expect(bar).toBeHidden();
  await expect.poll(() => chat.evaluate((node) => node.style.getPropertyValue("--customer-chat-avoid"))).toBe("0px");
});

test("customer chat keeps zero lift without a registered obstruction", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/contact.html`, { waitUntil: "domcontentloaded" });

  const chat = page.locator(".customer-chat");
  await page.locator(".customer-chat__toggle").waitFor();
  await expect(page.locator("[data-customer-chat-obstruction]")).toHaveCount(0);
  await expect.poll(() => chat.evaluate((node) => node.style.getPropertyValue("--customer-chat-avoid"))).toBe("0px");
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
  const burger = page.locator("#navBurger");
  await burger.click();

  const nav = page.locator("#navLinks");
  await expect(nav.getByRole("link", { name: "Products" })).toBeFocused();
  const topLevelColors = await page.locator("#navLinks > a, #navLinks summary").evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).color)
  );
  expect(topLevelColors).not.toContain("rgb(255, 255, 255)");

  await page.locator(".nav-group summary").click();
  await expect(nav.getByRole("link", { name: "Industries" })).toHaveAttribute("href", "../industries");
  await expect(nav.getByRole("link", { name: "Proof" })).toHaveAttribute("href", "../proof");

  const labelDelta = await page.locator(".nav-group summary").evaluate((node) => {
    const label = node.querySelector(".nav-group-label");
    if (!label) return Number.POSITIVE_INFINITY;
    const labelRect = label.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return Math.abs((labelRect.left + labelRect.width / 2) - (nodeRect.left + nodeRect.width / 2));
  });
  expect(labelDelta).toBeLessThan(2);

  await page.keyboard.press("Escape");
  await expect(nav).not.toHaveClass(/open/);
  await expect(burger).toBeFocused();
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

  await page.keyboard.press("Escape");
  await expect(page.locator(".nav-group")).not.toHaveJSProperty("open", true);

  await page.locator(".nav-group summary").click();
  await expect(page.locator(".nav-group")).toHaveJSProperty("open", true);
  await page.mouse.wheel(0, 240);
  await expect(page.locator(".nav-group")).not.toHaveJSProperty("open", true);
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

test("proof image sets use stable media slots", async ({ page }) => {
  const sets = [
    {
      pagePath: "index.html",
      viewport: { width: 1440, height: 900 },
      selector: ".proof-grid .proof-card > figure",
      expectedCount: 3,
      expectedAspectRatio: 16 / 10,
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
    if (set.expectedAspectRatio) {
      for (const box of result.boxes) {
        expect(
          Math.abs((box.width / box.height) - set.expectedAspectRatio),
          `${set.label} media ratio: ${JSON.stringify(box)}`,
        ).toBeLessThanOrEqual(0.03);
      }
    } else {
      expect(result.max - result.min, `${set.label} media heights: ${JSON.stringify(result.boxes)}`).toBeLessThanOrEqual(3);
    }
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
      selector: ".shop-toolbar.reveal",
      label: "product catalog toolbar",
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
      pagePath: "programs.html",
      viewport: { width: 1440, height: 1000 },
      selector: ".program-scope-visual.reveal",
      label: "program tier comparison",
    },
    {
      pagePath: "programs.html",
      viewport: { width: 390, height: 844 },
      selector: ".program-map-disclosure.reveal",
      label: "mobile program disclosure",
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
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, Math.max(0, top - Math.round(window.innerHeight * 0.65)));
      root.style.scrollBehavior = previousScrollBehavior;
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

test("comparison pages keep price tables inside their cards on tablet", async ({ page }) => {
  const comparisonPages = [
    "comparisons/beer-line-cleaner-cost-comparison.html",
    "comparisons/cr-hd-vs-simple-green.html",
    "comparisons/hcr-vs-rydlyme.html",
    "comparisons/lam3-vs-wet-forget.html",
    "comparisons/vertkleen-hcr-vs-clr.html",
  ];

  await page.setViewportSize({ width: 820, height: 900 });

  for (const pagePath of comparisonPages) {
    await page.goto(`${BASE_URL}/${pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const layout = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".product-static-panel")].map((panel) => {
        const panelBox = panel.getBoundingClientRect();
        const tables = [...panel.querySelectorAll(".table-scroll, .cmp-table")].map((node) => {
          const box = node.getBoundingClientRect();
          return {
            left: Math.round(box.left),
            right: Math.round(box.right),
            scrollDelta: Math.round(node.scrollWidth - node.clientWidth),
          };
        });
        return {
          left: Math.round(panelBox.left),
          right: Math.round(panelBox.right),
          tables,
        };
      });
      return {
        viewport: document.documentElement.clientWidth,
        pageOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
        panels,
      };
    });

    expect(layout.pageOverflow, `${pagePath} page overflow`).toBeLessThanOrEqual(2);
    for (const panel of layout.panels) {
      expect(panel.left, `${pagePath} panel left`).toBeGreaterThanOrEqual(0);
      expect(panel.right, `${pagePath} panel right`).toBeLessThanOrEqual(layout.viewport);
      for (const table of panel.tables) {
        expect(table.left, `${pagePath} table left`).toBeGreaterThanOrEqual(panel.left);
        expect(table.right, `${pagePath} table right`).toBeLessThanOrEqual(panel.right);
        expect(table.scrollDelta, `${pagePath} table internal overflow`).toBeLessThanOrEqual(2);
      }
    }
  }
});
