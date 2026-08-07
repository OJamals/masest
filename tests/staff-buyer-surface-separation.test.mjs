/* Staff and buyers get different products, and the buyer PAGES have to enforce it.
 *
 * The earlier separation pass only dressed the chrome: it hid the cart icon and
 * swapped the account dropdown for a staff list. Typing /dashboard, /cart, or
 * /checkout still served an admin the full customer workspace — cart prompts,
 * order history, business verification, NET terms. These tests render the real
 * pages under a staff fixture and a buyer fixture and assert the two audiences
 * actually see different things, so a future refactor cannot quietly merge them
 * back into one surface.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';
import { authStubModule } from '../tools/test-auth-stub.mjs';

const ROOT = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function withPage(canAdmin, fn) {
  const site = await startStaticTestServer(ROOT);
  const browser = await launchTestBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.MASEST_SUPABASE_URL = 'https://stub.supabase.co';
      window.MASEST_SUPABASE_ANON = 'stub-anon';
      localStorage.setItem('sb-stub-auth-token', JSON.stringify({ access_token: 'stub-token' }));
      localStorage.setItem('masest_cart', JSON.stringify({ hcr: 2 }));
    });
    const page = await context.newPage();
    await page.route('**/js/auth.js*', (route) => route.fulfill({
      status: 200, contentType: 'text/javascript', body: authStubModule({ canAdmin }),
    }));
    try { await fn(page, site.baseUrl); }
    finally { await context.close(); }
  } finally {
    await browser.close();
    await site.close();
  }
}

const dashboardState = (page) => page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.dash-tab')].map((t) => t.dataset.tab),
  panels: [...document.querySelectorAll('.dash-panel')].map((p) => p.dataset.panel),
  hash: location.hash,
  hasSidebar: !!document.querySelector('.dash-sidebar'),
  hasStaffNotice: !!document.querySelector('.staff-surface'),
  hasCompanyField: !!document.getElementById('pfCompany'),
  hasPrivacyCard: !!document.getElementById('dataExportBtn'),
  hasPasswordForm: !!document.getElementById('passwordChangeForm'),
  greeting: document.getElementById('dashGreeting')?.textContent || '',
}));

test('staff on the customer dashboard get their own login and nothing else', async () => {
  await withPage(true, async (page, baseUrl) => {
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'load' });
    await page.waitForSelector('.staff-surface', { timeout: 10000 });
    const state = await dashboardState(page);

    // Buyer sections are removed, not hidden: a hidden tab still takes roving
    // focus and a hidden panel still answers its deep link.
    assert.deepEqual(state.panels, ['profile'], 'staff should keep only the profile panel');
    assert.deepEqual(state.tabs, [], 'a single destination needs no section rail');
    assert.equal(state.hasSidebar, false, 'the section rail should be gone for staff');
    assert.equal(state.hasCompanyField, false, 'company is the buyer business account, not a staff field');
    assert.equal(state.hasPrivacyCard, false, 'export and self-delete are data-subject rights over a buyer account');
    assert.equal(state.hasPasswordForm, true, 'staff still own their login, so password change stays');
    assert.match(state.greeting, /staff/i, 'the greeting should not welcome staff back as a customer');
  });
});

test('a stale buyer deep link cannot reopen a buyer section for staff', async () => {
  await withPage(true, async (page, baseUrl) => {
    for (const hash of ['#orders', '#business', '#addresses']) {
      await page.goto(`${baseUrl}/dashboard.html${hash}`, { waitUntil: 'load' });
      await page.waitForSelector('.staff-surface', { timeout: 10000 });
      const state = await dashboardState(page);
      assert.deepEqual(state.panels, ['profile'], `${hash} should not restore a buyer panel`);
      assert.equal(state.hash, '#profile', `${hash} should be pinned back to the surviving section`);
    }
  });
});

test('the buyer dashboard is untouched for a customer', async () => {
  await withPage(false, async (page, baseUrl) => {
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'load' });
    await page.waitForSelector('.dash-panel[data-panel="overview"]:not([hidden])', { timeout: 10000 });
    const state = await dashboardState(page);

    assert.equal(state.hasStaffNotice, false, 'buyers should never see the staff notice');
    assert.equal(state.hasSidebar, true, 'buyers keep the section rail');
    assert.equal(state.tabs.length, 7, 'buyers keep all seven sections');
    assert.ok(state.panels.includes('business'), 'buyers keep business tools');
    assert.ok(state.panels.includes('orders'), 'buyers keep order history');
    assert.equal(state.hasPrivacyCard, true, 'buyers keep export and account deletion');
  });
});

for (const [label, path] of [['cart', 'cart.html'], ['checkout', 'checkout.html']]) {
  test(`staff cannot shop through ${label}`, async () => {
    await withPage(true, async (page, baseUrl) => {
      await page.goto(`${baseUrl}/${path}`, { waitUntil: 'load' });
      await page.waitForSelector('.staff-surface', { timeout: 10000 });
      const surface = await page.evaluate(() => ({
        adminLink: !!document.querySelector('.staff-surface a[href$="admin.html"]'),
        // The buyer machinery must be gone from the page, not merely hidden.
        cartLines: !!document.getElementById('cartLines'),
        checkoutShell: !!document.getElementById('checkoutShell'),
        payButton: !!document.getElementById('checkoutPay'),
      }));
      assert.equal(surface.adminLink, true, 'the notice should route staff to the console');
      assert.equal(surface.cartLines, false, `${label} should not render cart lines for staff`);
      assert.equal(surface.checkoutShell, false, `${label} should not render the checkout shell for staff`);
      assert.equal(surface.payButton, false, `${label} should not build a payment control for staff`);
    });
  });
}

test('a customer can still reach cart and checkout', async () => {
  await withPage(false, async (page, baseUrl) => {
    await page.goto(`${baseUrl}/cart.html`, { waitUntil: 'load' });
    await page.waitForSelector('#cartLines .cart-line, #cartLines [data-sku]', { timeout: 10000 });
    assert.equal(await page.locator('.staff-surface').count(), 0, 'buyers should not get the staff notice on the cart');

    await page.goto(`${baseUrl}/checkout.html`, { waitUntil: 'load' });
    await page.waitForSelector('#checkoutShell:not([hidden])', { timeout: 10000 });
    assert.equal(await page.locator('.staff-surface').count(), 0, 'buyers should not get the staff notice at checkout');
  });
});

test('every buyer surface decides staff the same way', () => {
  const gate = read('js/staff-surface.js');
  assert.match(gate, /account\?\.can_admin === true/, 'the gate must read the purpose-built can_admin flag');

  // can_admin is computed server-side from the staff allowlist or an explicit
  // is_staff + staff_role profile. Re-deriving staff from the company role (which
  // is "admin" for any business owner) would lock real customers out of the store.
  for (const path of ['js/dashboard.js', 'js/checkout.js', 'cart.html']) {
    const source = read(path);
    assert.match(source, /isStaffAccount/, `${path} should call the shared gate`);
    assert.doesNotMatch(source, /profile\?\.role === ['"]admin['"]\s*\)?\s*(\?|&&)?\s*(return|\{)?\s*(replaceBuyerSurface|bootStaffAccount)/,
      `${path} must not infer staff from the company role`);
  }
});
