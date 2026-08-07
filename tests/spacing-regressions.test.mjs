/* Spacing-regression guard for the public site and both authenticated shells.
 *
 * Hand-written spacing assertions only cover the selectors someone thought to
 * name, which is why crowding kept coming back: text flush against a card edge,
 * controls fused together, headings colliding with body copy. This measures
 * RENDERED geometry on real pages, so any CSS change that reintroduces the
 * defect fails here regardless of which rule caused it.
 *
 * A finding is a real defect, not a threshold to relax. Genuinely joined UI
 * (segmented controls, tight display lockups) opts out in the markup with
 * data-spacing-joined, which keeps the intent visible where the markup lives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';
import { authStubModule } from '../tools/test-auth-stub.mjs';
import { detectSpacingViolations, SPACING_LIMITS, SPACING_OPT_OUT } from '../tools/spacing-audit.mjs';

const ROOT = new URL('..', import.meta.url);
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
const OPTIONS = { ...SPACING_LIMITS, optOut: SPACING_OPT_OUT };

const PUBLIC_ROUTES = [
  'index.html', 'products.html', 'services.html', 'programs.html', 'resources.html',
  'about.html', 'contact.html', 'proof.html', 'industries.html', 'blog.html',
  'cart.html', 'account.html', 'products/hcr.html',
];
const ADMIN_TABS = ['overview', 'orders', 'quotes', 'products', 'companies', 'crm', 'content', 'reviews', 'newsletter', 'analytics', 'finance', 'integrations'];
const DASHBOARD_TABS = ['orders', 'profile', 'addresses', 'messages', 'notifications'];

function report(violations) {
  const seen = new Map();
  for (const violation of violations) {
    const key = `${violation.rule}|${violation.surface}|${violation.text}|${violation.side || ''}`;
    if (!seen.has(key)) seen.set(key, { ...violation, where: new Set() });
    seen.get(key).where.add(violation.where);
  }
  return [...seen.values()]
    .map((v) => `  [${v.rule}${v.side ? `/${v.side}` : ''}] gap ${v.gap}px < ${v.limit}px — ${v.surface} > ${v.text}${v.sample ? ` ("${v.sample}")` : ''} on ${[...v.where].slice(0, 3).join(', ')}`)
    .join('\n');
}

async function auditRoutes(open) {
  const site = await startStaticTestServer(ROOT);
  const browser = await launchTestBrowser();
  const violations = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        window.MASEST_SUPABASE_URL = 'https://stub.supabase.co';
        window.MASEST_SUPABASE_ANON = 'stub-anon';
        localStorage.setItem('sb-stub-auth-token', JSON.stringify({ access_token: 'stub-token' }));
      });
      const page = await context.newPage();
      await page.route('**/js/auth.js*', (route) => route.fulfill({
        status: 200, contentType: 'text/javascript', body: authStubModule(),
      }));
      try {
        for await (const label of open(page, site.baseUrl)) {
          const found = await page.evaluate(detectSpacingViolations, OPTIONS);
          found.forEach((item) => violations.push({ ...item, where: `${viewport.width}w ${label}` }));
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await site.close();
  }
  return violations;
}

test('public pages keep text, cards, and controls spaced apart', async () => {
  const violations = await auditRoutes(async function* (page, baseUrl) {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(`${baseUrl}/${route}`, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      yield route;
    }
  });
  assert.equal(violations.length, 0, `spacing regressions on public pages:\n${report(violations)}`);
});

test('admin console keeps text, cards, and controls spaced apart', async () => {
  const violations = await auditRoutes(async function* (page, baseUrl) {
    for (const tab of ADMIN_TABS) {
      await page.goto(`${baseUrl}/admin.html#${tab}`, { waitUntil: 'load' });
      await page.waitForSelector(`.adm-panel[data-panel="${tab}"][data-active="true"]`, { timeout: 10000 });
      await page.waitForTimeout(800);
      yield `admin#${tab}`;
    }
  });
  assert.equal(violations.length, 0, `spacing regressions in the admin console:\n${report(violations)}`);
});

test('customer dashboard keeps text, cards, and controls spaced apart', async () => {
  const violations = await auditRoutes(async function* (page, baseUrl) {
    for (const tab of DASHBOARD_TABS) {
      await page.goto(`${baseUrl}/dashboard.html#${tab}`, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      yield `dashboard#${tab}`;
    }
  });
  assert.equal(violations.length, 0, `spacing regressions in the customer dashboard:\n${report(violations)}`);
});
