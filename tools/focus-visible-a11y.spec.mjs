import { spawn } from "node:child_process";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

// a11y guard: the commerce/shop pill controls suppress the default outline, so they need an
// explicit :focus-visible ring or keyboard focus is invisible. Asserts the rules shipped and
// parsed (the browser drops invalid rules, so presence in document.styleSheets == valid CSS).
const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(`${BASE_URL}/products.html`);
});

test.afterAll(() => {
  if (!server) return;
  server.kill();
  server.unref();
  server = null;
});

test("commerce controls ship a valid :focus-visible ring", async ({ page }) => {
  await page.goto(`${BASE_URL}/products.html`, { waitUntil: "domcontentloaded" });

  // Flatten every CSS rule from same-origin stylesheets into {selector, boxShadow, outline}.
  const rules = await page.evaluate(() => {
    const out = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules;
      try { cssRules = sheet.cssRules; } catch { continue; } // cross-origin guard
      for (const rule of Array.from(cssRules || [])) {
        if (rule.selectorText && rule.selectorText.includes(":focus-visible")) {
          out.push({ selector: rule.selectorText, boxShadow: rule.style.boxShadow, outline: rule.style.outline });
        }
      }
    }
    return out;
  });

  const ringFor = (needle) =>
    rules.find((r) => r.selector.includes(needle) && r.boxShadow && r.boxShadow !== "none");

  expect(ringFor(".shop-card-add:focus-visible"), "shop-card-add needs a focus ring").toBeTruthy();
  expect(ringFor(".shop-card-quote:focus-visible"), "shop-card-quote needs a focus ring").toBeTruthy();
  expect(ringFor(".commerce-vol:focus-visible"), "commerce-vol needs a focus ring").toBeTruthy();
  expect(ringFor(".shop-card-proof-link:focus-visible"), "proof link needs a focus ring").toBeTruthy();

  // Baseline global focus-visible (outline) is still present.
  const globalRule = rules.find((r) => r.selector.trim() === ":focus-visible" && r.outline);
  expect(globalRule, "global :focus-visible outline must remain").toBeTruthy();
});

for (const width of [390, 1512]) {
  for (const components of [false, true]) {
    test(`skip link stays readable after scrolling (${width}px, components=${components})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      // Use the shipped styles with a minimal page: scrolling must not turn a
      // keyboard-focused skip link into a blank, partially clipped rectangle.
      await page.route(`${BASE_URL}/skip-link-fixture.html`, (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head>
          <link rel="stylesheet" href="/css/style.css">
          ${components ? '<link rel="stylesheet" href="/css/components.css">' : ''}
        </head><body>
          <a class="skip-link" href="#main">Skip to content</a>
          <header><a href="#main">Home</a></header>
          <main id="main" tabindex="-1" style="min-height:2000px;padding-top:100px">
            <button>First content control</button>
          </main>
        </body></html>`,
      }));
      await page.goto(`${BASE_URL}/skip-link-fixture.html`);
      const skip = page.getByRole("link", { name: "Skip to content", exact: true });
      const intersectsViewport = (rect) => rect.x + rect.width > 0 && rect.x < width
        && rect.y + rect.height > 0 && rect.y < 800;

      expect(intersectsViewport(await skip.boundingBox())).toBe(false);
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      const focused = await skip.boundingBox();
      expect(focused.x).toBeGreaterThanOrEqual(0);
      expect(focused.y).toBeGreaterThanOrEqual(0);

      await page.mouse.move(width - 30, 300);
      await page.mouse.wheel(0, 27);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(27);
      await expect(skip).toBeFocused();
      expect(await skip.boundingBox()).toEqual(focused);

      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();
      await expect(page).toHaveURL(/#main$/);
      expect(intersectsViewport(await skip.boundingBox())).toBe(false);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "First content control" })).toBeFocused();
    });
  }
}
