import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

const ROOT = new URL("..", import.meta.url);
const ROOT_PATH = ROOT.pathname;
const EXPECTED_LOGOS = [
  "/img/masest-logo.png",
  "/img/masest-logo-ink.png",
];

function sourceFiles(directory = ROOT_PATH) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "dist" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path];
  });
}

function referencedLogoPaths() {
  const extensions = new Set([".html", ".js", ".json", ".mjs"]);
  const pattern = /(?:https:\/\/masest\.co)?\/img\/[^"'`\s<>)\\]*logo[^"'`\s<>)\\]*\.(?:avif|jpe?g|png|svg|webp)/gi;
  const paths = new Set();

  for (const path of sourceFiles()) {
    if (!extensions.has(extname(path))) continue;
    for (const match of readFileSync(path, "utf8").matchAll(pattern)) {
      paths.add(match[0].replace("https://masest.co", ""));
    }
  }

  return [...paths].sort();
}

test("every referenced MASEST logo has a local source fallback", () => {
  assert.deepEqual(referencedLogoPaths(), [...EXPECTED_LOGOS].sort());
  const manifest = JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8"));
  const cmsPaths = new Set(manifest.assets.map((asset) => asset.public_url));

  for (const publicPath of EXPECTED_LOGOS) {
    const file = new URL(`..${publicPath}`, import.meta.url);
    assert.equal(existsSync(file), true, `${publicPath} should exist for raw static rendering`);
    assert.ok(statSync(file).size > 0, `${publicPath} should not be empty`);
    assert.equal(cmsPaths.has(publicPath), false, `${publicPath} should remain outside the CMS image library`);
  }
});

test("shared chrome renders decoded, named logos on root and nested routes", async () => {
  const staticSite = await startStaticTestServer(ROOT);
  const browser = await launchTestBrowser({ channel: "chrome" });

  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      try {
        // admin.html is excluded: the staff console renders its own chrome with no
        // marketing footer, so it has no .foot-logo. Its logo is covered by the
        // staff-chrome guard in tests/admin-shared-chrome.test.mjs.
        for (const [route, visibleNavLogo] of [
          ["index.html", "logo-grad"],
          ["products/hcr.html", "logo-ink"],
        ]) {
          const failedLogoResponses = [];
          const onResponse = (response) => {
            if (/\/img\/masest-logo(?:-ink)?\.png(?:$|\?)/.test(response.url()) && !response.ok()) {
              failedLogoResponses.push(`${response.status()} ${response.url()}`);
            }
          };
          page.on("response", onResponse);

          await page.goto(`${staticSite.baseUrl}/${route}`, { waitUntil: "load" });
          await page.locator(".nav-logo").waitFor();
          await page.locator(".foot-logo").waitFor();
          const visibleNavigationClass = await page.evaluate(() =>
            [...document.querySelectorAll(".nav-logo img")]
              .find((image) => {
                const rect = image.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              })?.className || "",
          );
          assert.equal(await page.locator(".foot-logo").getAttribute("loading"), "lazy");
          await page.locator(".foot-logo").scrollIntoViewIfNeeded();
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".nav-logo img, .foot-logo")]
              .every((image) => image.complete && image.naturalWidth > 0),
          );

          const logos = await page.evaluate(() => ({
            navLabel: document.querySelector(".nav-logo")?.getAttribute("aria-label") || "",
            footerLabel: document.querySelector(".foot-logo-link")?.getAttribute("aria-label") || "",
            footerText: document.querySelector(".foot-brand")?.textContent?.trim() || "",
            images: [...document.querySelectorAll(".nav-logo img, .foot-logo")].map((image) => {
              const rect = image.getBoundingClientRect();
              return {
                className: image.className,
                alt: image.getAttribute("alt"),
                ariaHidden: image.getAttribute("aria-hidden"),
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                renderedWidth: rect.width,
                renderedHeight: rect.height,
              };
            }),
          }));

          page.off("response", onResponse);
          assert.deepEqual(failedLogoResponses, [], `${route} should load every logo`);
          assert.equal(logos.navLabel, "MASEST home");
          assert.equal(logos.footerLabel, "MASEST home");
          assert.match(logos.footerText, /^MASEST VertKleen/);
          assert.equal(logos.images.length, 3);
          assert.equal(logos.images[0].alt, "MASEST");
          assert.equal(logos.images[1].alt, "");
          assert.equal(logos.images[1].ariaHidden, "true");
          assert.equal(logos.images[2].alt, "MASEST");
          for (const image of logos.images) {
            assert.equal(image.complete, true, `${route} logo should finish loading`);
            assert.ok(image.naturalWidth > 0, `${route} logo should decode`);
            assert.ok(image.naturalHeight > 0, `${route} logo should have intrinsic height`);
          }
          assert.match(
            visibleNavigationClass,
            new RegExp(`(?:^|\\s)${visibleNavLogo}(?:\\s|$)`),
            `${route} should show its contrast-appropriate ${visibleNavLogo}`,
          );
          assert.ok(logos.images[2].renderedWidth > 0, `${route} footer logo should have rendered width`);
          assert.ok(logos.images[2].renderedHeight > 0, `${route} footer logo should have rendered height`);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await staticSite.close();
  }
});
