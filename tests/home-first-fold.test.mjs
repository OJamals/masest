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
    assert.equal(await page.locator('.home-hero').getByRole('link', { name: 'Explore products' }).isVisible(), true);
    assert.equal(await page.locator('.home-hero').getByRole('link', { name: 'Help me choose' }).isVisible(), true);
    assert.equal(await page.locator('.home-private-option').getByRole('link', { name: 'Explore private label' }).isVisible(), true);
    assert.equal(await page.getByRole('link', { name: 'Read the field record' }).isVisible(), true);
    assert.equal(await page.locator('.nojs-nav').getByRole('link', { name: 'Private Label', exact: true }).isVisible(), true);
  } finally { await browser.close(); await server.close(); }
});

test('homepage job choices precede field proof and private label stays directly discoverable', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(server.baseUrl);
    await page.locator('.nav').waitFor();
    const sections = await page.locator('main > section').evaluateAll(nodes => nodes.map(node => node.id));
    assert.ok(sections.indexOf('find-cleaner') < sections.indexOf('results'));
    assert.equal(await page.locator('#find-cleaner .home-job').count(), 4);
    const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    assert.equal(await primary.getByRole('link', { name: 'Private Label', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.home-buying').getByRole('link', { name: /Need bulk supply/ }).getAttribute('href'), 'contact?type=quote&message=Please%20help%20me%20plan%20bulk%20VertKleen%20supply.#quoteForm');
  } finally { await browser.close(); await server.close(); }
});

test('homepage product advice carries selection context into email and callback requests', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(server.baseUrl);
    await page.getByRole('link', { name: 'Help me choose', exact: true }).click();
    await page.getByRole('button', { name: 'Add request details' }).waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('type'), 'quote');
    assert.equal(await page.locator('#fMessage').inputValue(), 'Help me choose a VertKleen cleaner for my application.');
    await page.getByRole('button', { name: 'Add request details' }).click();
    assert.equal(await page.locator('#fType').inputValue(), 'quote');
    await page.locator('#requestExtraDetails > summary').click();
    assert.equal(await page.getByRole('button', { name: 'Quote', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Replace a Cleaner', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Request a call' }).click();
    assert.equal(await page.locator('#fType').inputValue(), 'callback');
    assert.equal(await page.locator('#fRequestTopic').inputValue(), 'quote');
    await page.getByRole('button', { name: 'Add request details' }).click();
    assert.equal(await page.locator('#fMessage').inputValue(), 'Help me choose a VertKleen cleaner for my application.');
  } finally { await browser.close(); await server.close(); }
});

test('homepage tracking reports one privacy-limited event per mouse or keyboard choice', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const events = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.exposeFunction('recordHomeEvent', (event, detail) => events.push({ event, detail }));
    await page.addInitScript(() => { window.mtrack = (event, detail) => window.recordHomeEvent(event, detail); });
    await page.goto(server.baseUrl);
    await page.locator('.home-hero .home-button i').click();
    assert.equal(new URL(page.url()).pathname, '/products');
    await page.goto(server.baseUrl);
    const advice = page.getByRole('link', { name: 'Help me choose', exact: true });
    await advice.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/contact?type=quote&message=*');
    assert.deepEqual(events.filter(({ event }) => event.startsWith('home_')), [
      { event: 'home_product_click', detail: { source: 'home_hero_products' } },
      { event: 'home_advice_click', detail: { source: 'home_hero_advice', request_type: 'quote' } },
    ]);
  } finally { await browser.close(); await server.close(); }
});
