import assert from 'node:assert/strict';
import test from 'node:test';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';

test('landing pages keep buyer actions visible and layouts within each viewport', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    for (const width of [320, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 900 }, reducedMotion: 'reduce' });
      for (const path of ['/', '/private-label']) {
        await page.goto(server.baseUrl + path);
        await page.locator('.nav').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const dimensions = await page.evaluate(() => {
          const cta = document.querySelector('.home-hero .home-button').getBoundingClientRect();
          return { scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight, top: cta.top, bottom: cta.bottom };
        });
        assert.ok(dimensions.scroll <= width + 1, `${path} overflows at ${width}px`);
        assert.ok(dimensions.top >= 0 && dimensions.bottom <= dimensions.height, `${path} CTA below fold at ${width}px: ${dimensions.bottom}`);
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.locator('.brand-wordmark, .home-wordmark').count(), 0);
        assert.equal(await page.locator('.nav-logo .logo-grad').evaluate(el => Math.round(el.getBoundingClientRect().height)), width <= 820 ? 44 : 48);
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});

test('homepage keyboard navigation exposes skip link, private label, and HVAC menu entry', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(server.baseUrl);
    await page.locator('.nav').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => location.hash), '#main');
    const applications = page.locator('.nav-group').filter({ hasText: 'Applications' }).locator('summary');
    await applications.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('link', { name: 'HVAC & Water Systems', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('link', { name: 'HVAC & Water Systems', exact: true }).isVisible(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'HVAC & Water Systems', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('link', { name: 'HVAC & Water Systems', exact: true }).isVisible(), false);
    await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Private Label', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/private-label');
  } finally { await browser.close(); await server.close(); }
});

test('homepage retains both buying routes and readable proof without JavaScript', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await page.goto(server.baseUrl);
    assert.equal(await page.locator('.home-hero').getByRole('link', { name: 'Request a private-label quote' }).isVisible(), true);
    assert.equal(await page.locator('.home-hero').getByRole('link', { name: 'Shop VertKleen' }).isVisible(), true);
    assert.equal(await page.getByRole('link', { name: 'Read the field record' }).isVisible(), true);
    assert.equal(await page.locator('.nojs-nav').getByRole('link', { name: 'Private Label', exact: true }).isVisible(), true);
  } finally { await browser.close(); await server.close(); }
});
