#!/usr/bin/env node
/**
 * render-og.mjs — render tools/og-card.html to img/og-card.png at 1200x630.
 *
 * Deterministic source for the social share card so it can be regenerated:
 * edit tools/og-card.html, re-run `node tools/render-og.mjs`, commit the PNG.
 *
 * Uses Playwright (a dev/test dependency). Renders at 2x for crisp text,
 * then downscales to exactly 1200x630 with `sips` (macOS).
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = pathToFileURL(resolve(here, 'og-card.html')).href;
const out = resolve(root, 'img/og-card.png');

const W = 1200, H = 630;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
});
await page.goto(src, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(150); // let gradients/shadows settle
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();

// Normalize to exactly 1200x630 (screenshot is 2x = 2400x1260).
execFileSync('sips', ['-z', String(H), String(W), out], { stdio: 'ignore' });
console.log(`wrote ${out} (${W}x${H})`);
