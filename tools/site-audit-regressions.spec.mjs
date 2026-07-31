import { expect, test } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

let BASE_URL = "";
let staticSite;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

test("mobile and tablet header keeps every action inside the viewport", async ({ page }) => {
  for (const width of [390, 768, 800, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".nav-links")).toBeHidden();
    await expect(page.locator(".nav-burger")).toBeVisible();
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
      expect(box.left, `${width} ${box.className} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${width} ${box.className} right edge`).toBeLessThanOrEqual(width);
      expect(box.width, `${width} ${box.className} width`).toBeGreaterThan(20);
      expect(box.height, `${width} ${box.className} height`).toBeGreaterThanOrEqual(44);
    }

    await page.locator(".nav-burger").click();
    await expect(page.locator(".nav-links")).toBeVisible();
    const menu = await page.locator(".nav-links").boundingBox();
    expect(menu?.x, `${width} open-menu left edge`).toBeGreaterThanOrEqual(0);
    expect(menu?.x + menu?.width, `${width} open-menu right edge`).toBeLessThanOrEqual(width);
  }
});

test("desktop header begins after tablet collapse without overlap", async ({ page }) => {
  for (const width of [821, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".nav-links")).toBeVisible();
    await expect(page.locator(".nav-burger")).toBeHidden();
    const boxes = await page.locator(".nav-logo, .nav-links, .nav-actions")
      .evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }));
    expect(boxes[0].right, `${width} logo/nav gap`).toBeLessThanOrEqual(boxes[1].left);
    expect(boxes[1].right, `${width} nav/actions gap`).toBeLessThanOrEqual(boxes[2].left);
  }
});

test("mobile catalog starts concise and expands without hiding search results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/products.html#catalog`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#shopGrid .shop-card")).toHaveCount(15);
  await expect(page.locator("#shopGrid .shop-card:visible")).toHaveCount(6);
  await expect(page.locator("#shopMore")).toBeVisible();
  await expect(page.locator("#shopMore")).toContainText("9 more");

  await page.locator("#shopMore").click();
  await expect(page.locator("#shopGrid .shop-card:visible")).toHaveCount(15);
  await expect(page.locator("#shopMore")).toBeHidden();

  await page.locator("#shopSearch").fill("descaler");
  await expect(page.locator("#shopGrid .shop-card:visible")).toHaveCount(1);
});

test("mobile catalog filters stay inside the page width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/products.html#catalog`, { waitUntil: "domcontentloaded" });

  const layout = await page.locator(".shop-chips").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      body: document.body.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });

  expect(layout.body).toBeLessThanOrEqual(layout.viewport);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
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
  await page.waitForFunction(() => {
    const gate = document.getElementById("admGate");
    const app = document.getElementById("admApp");
    return gate && app && (!gate.hidden || !app.hidden);
  });
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
  await expect(page.getByRole("button", { name: /add request details/i })).toBeVisible();
  await expect(page.locator("#fVolume")).toBeHidden();
  await expect(page.locator("#quoteTaskDetails")).toBeHidden();

  await page.getByRole("button", { name: /add request details/i }).click();
  await expect(page.locator("#fVolume")).toBeVisible();
  await expect(page.locator("#quoteTaskDetails")).toBeVisible();
});

test("mobile non-catalog pages expose persistent quote and chemical-map actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/services.html`, { waitUntil: "domcontentloaded" });

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
      cardSelector: ".proof-grid .proof-card",
      mediaSelector: ":scope > figure",
      expectedAspectRatio: 16 / 10,
      label: "home proof cards",
    },
    {
      pagePath: "proof.html",
      viewport: { width: 1440, height: 900 },
      cardSelector: ".case-grid .case-card:not([hidden])",
      mediaSelector: ":scope > :is(.case-media, .case-ba, img)",
      readySelector: '.case-grid[data-cms-content="proof_cards"]',
      label: "proof case cards",
    },
  ];

  for (const set of sets) {
    await page.setViewportSize(set.viewport);
    await page.goto(`${BASE_URL}/${set.pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    if (set.readySelector) {
      await expect(page.locator(set.readySelector)).toHaveAttribute("data-cms-loaded", "true");
    }

    const result = await page.locator(set.cardSelector).evaluateAll((cards, mediaSelector) => {
      const samples = cards
        .filter((card) => !card.hidden && getComputedStyle(card).display !== "none")
        .map((card) => {
          const node = card.querySelector(mediaSelector);
          if (!node) return { card: card.id || card.dataset.assetId || "", height: 0, width: 0, src: "" };
          const rect = node.getBoundingClientRect();
          const img = node.matches("img") ? node : node.querySelector("img");
          return {
            card: card.id || card.dataset.assetId || "",
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            src: img?.getAttribute("src") || "",
          };
        });
      const boxes = samples.filter((box) => box.width > 80 && box.height > 80);
      const heights = boxes.map((box) => box.height);
      return {
        boxes,
        cardCount: samples.length,
        invalid: samples.filter((box) => box.width <= 80 || box.height <= 80),
        min: Math.min(...heights),
        max: Math.max(...heights),
      };
    }, set.mediaSelector);

    expect(result.boxes, `${set.label} media count; invalid: ${JSON.stringify(result.invalid)}`).toHaveLength(result.cardCount);
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
    await expect.poll(
      () => section.evaluate((node) => node.classList.contains("in")),
      { message: `${item.label} should receive reveal class` },
    ).toBe(true);
    await expect.poll(
      () => section.evaluate((node) => Number(getComputedStyle(node).opacity)),
      { message: `${item.label} opacity` },
    ).toBeGreaterThan(0.85);
    await expect.poll(
      () => section.evaluate((node) => getComputedStyle(node).transform),
      { message: `${item.label} transform` },
    ).toBe("none");
  }
});

test("cart and product static preview avoid unavailable commerce API", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/products")) apiRequests.push(request.url());
  });

  for (const pagePath of ["cart.html", "products/hcr.html"]) {
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
    await page.locator(".product-static-panel").first().waitFor();
    await expect(page.locator(".product-hero-media img")).toHaveJSProperty("complete", true);

    const layout = await page.evaluate(() => {
      const heroImage = document.querySelector(".product-hero-media img");
      const heroBox = heroImage?.getBoundingClientRect();
      const intrinsicWidth = Number(heroImage?.getAttribute("width"));
      const intrinsicHeight = Number(heroImage?.getAttribute("height"));
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
        heroAspectDelta: heroImage && heroBox?.height && intrinsicWidth && intrinsicHeight
          ? Math.abs((heroBox.width / heroBox.height) - (intrinsicWidth / intrinsicHeight))
          : null,
        panels,
      };
    });

    expect(layout.pageOverflow, `${pagePath} page overflow`).toBeLessThanOrEqual(2);
    expect(layout.heroAspectDelta, `${pagePath} hero image distortion`).not.toBeNull();
    expect(layout.heroAspectDelta, `${pagePath} hero image distortion`).toBeLessThan(0.02);
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
