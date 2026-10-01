/* Verify every shipped industry product card in desktop and mobile browsers.
 * Usage: MASEST_LIVE_MEDIA=1 node tools/audit-industry-product-images.mjs https://masest.co reports/industry-product-images/live
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { attr, find, findAll, textOf } from "./html-query.mjs";
import { wrapBrowserWithMediaIsolation } from "./test-media-isolation.mjs";

const base = process.argv[2] || "http://127.0.0.1:4198";
assert.equal(process.env.MASEST_LIVE_MEDIA, "1", "Set MASEST_LIVE_MEDIA=1 to audit real image bytes");
assert.ok(!process.env.CI, "Live image auditing must run outside CI");
const output = resolve(process.argv[3] || "reports/industry-product-images/browser");
const industries = JSON.parse(readFileSync("data/industry-applications.json", "utf8")).industries;
mkdirSync(output, { recursive: true });
const browser = wrapBrowserWithMediaIsolation(await chromium.launch({ headless: true }));
const results = [];
try {
  for (const [view, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["tablet", { width: 1024, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
    ["small-mobile", { width: 320, height: 700 }],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    if (new URL(base).hostname === "127.0.0.1") {
      const catalog = await (await fetch("https://masest.co/api/products")).text();
      await context.route("**/api/products**", route => route.fulfill({ contentType: "application/json", body: catalog }));
    }
    const page = await context.newPage();
    for (const { slug } of industries) {
      const expected = findAll(readFileSync(`industries/${slug}.html`, "utf8"), { classes: ["prod-card"] }).map(card => ({
        id: attr(card, "data-product-id"),
        name: textOf(find(card, { tag: "h3" })),
        src: `https://media.masest.co/site/${attr(find(card, { tag: "img" }), "src").replace(/^\.\.\//, "")}`,
      }));
      const result = { view, slug, cards: [], errors: [] };
      results.push(result);
      try {
        const response = await page.goto(`${base}/industries/${slug}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        assert.equal(response.status(), 200, "page must return HTTP 200");
        const cards = page.locator(".prod-card");
        assert.equal(await cards.count(), expected.length, "all static cards must survive hydration");
        for (let index = 0; index < expected.length; index++) {
          const card = cards.nth(index);
          await card.scrollIntoViewIfNeeded();
          await page.waitForFunction(index => {
            const img = document.querySelectorAll(".prod-card")[index]?.querySelector("img");
            return img?.complete && img.naturalWidth > 0;
          }, index, { timeout: 15000 });
          await card.evaluate(async el => {
            const img = el.querySelector("img");
            if (!img) throw new Error("missing product image");
            await img.decode();
          });
          await page.waitForFunction(index => {
            const card = document.querySelectorAll(".prod-card")[index];
            return Number(getComputedStyle(card).opacity) === 1;
          }, index, { timeout: 10000 });
          const actual = await card.evaluate(el => {
            const img = el.querySelector("img");
            const rect = img.getBoundingClientRect();
            return {
              id: el.dataset.productId, name: el.querySelector("h3").textContent.trim(),
              src: img.currentSrc, alt: img.alt,
              naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
              visible: rect.width > 0 && rect.height > 0 && getComputedStyle(img).visibility === "visible"
                && Number(getComputedStyle(img).opacity) > 0 && img.checkVisibility(),
              contained: getComputedStyle(img).objectFit === "contain",
            };
          });
          assert.equal(actual.id, expected[index].id, "card product identity");
          assert.equal(actual.name, expected[index].name, "card name");
          assert.equal(actual.src, expected[index].src, "correct product image must remain after hydration");
          assert.ok(actual.naturalWidth > 0 && actual.naturalHeight > 0 && actual.alt, "image must decode and have alt text");
          assert.ok(actual.visible, "image must be visibly painted");
          assert.ok(actual.contained, "whole product must remain in frame");
          const packages = await card.locator(".commerce-vol").evaluateAll(selects => selects.map(select => {
            const style = getComputedStyle(select);
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            context.font = style.font;
            const label = select.closest("label")?.querySelector(".commerce-pack-label");
            return {
              selected: select.selectedOptions[0]?.textContent.trim(),
              textWidth: context.measureText(select.selectedOptions[0]?.textContent || "").width,
              availableWidth: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
              packageLabel: label?.textContent.trim(),
              height: select.getBoundingClientRect().height,
            };
          }));
          for (const pack of packages) {
            assert.equal(pack.packageLabel, "Package size", "visible package size label");
            assert.ok(pack.height >= 44, "package selector needs a 44px target");
            assert.ok(pack.availableWidth >= pack.textWidth + 16, `selected package is clipped: ${pack.selected}`);
          }
          actual.packages = packages;
          result.cards.push(actual);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "no horizontal overflow");
        if (["hotels-property-management", "breweries-distilleries-wineries", "marine", "golf-courses"].includes(slug)) {
          const section = page.locator("#products-for-this-industry");
          await section.scrollIntoViewIfNeeded();
          await section.screenshot({ path: `${output}/${slug}-${view}.png` });
        }
      } catch (error) {
        result.errors.push(error.message);
      }
      console.log(`${view} ${slug}: ${result.cards.length}/${expected.length} images; ${result.errors.length} errors`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${output}/audit.json`, JSON.stringify({ base, results }, null, 2) + "\n");
}
const failures = results.filter(row => row.errors.length);
console.log(`Industry image audit: ${results.length} page/viewport checks, ${results.reduce((n, row) => n + row.cards.length, 0)} painted images, ${failures.length} failures`);
if (failures.length) process.exitCode = 1;
