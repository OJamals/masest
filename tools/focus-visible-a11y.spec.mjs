import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

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

  // Baseline global focus-visible (outline) is still present.
  const globalRule = rules.find((r) => r.selector.trim() === ":focus-visible" && r.outline);
  expect(globalRule, "global :focus-visible outline must remain").toBeTruthy();
});
