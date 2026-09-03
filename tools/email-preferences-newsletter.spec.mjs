import { test, expect } from './playwright-test.mjs';
import { startStaticTestServer } from './test-static-server.mjs';
import { authStubModule } from './test-auth-stub.mjs';

const ROOT = new URL('..', import.meta.url);
const SCREENSHOT_DIR = 'output/playwright/email-model';
let site;

test.beforeAll(async () => {
  site = await startStaticTestServer(ROOT);
});

test.afterAll(async () => {
  await site?.close();
});

async function boot(page, { canAdmin }) {
  const consoleProblems = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error' || entry.type() === 'warning') consoleProblems.push(`${entry.type()}: ${entry.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = 'https://stub.supabase.co';
    window.MASEST_SUPABASE_ANON = 'stub-anon';
  });
  await page.route('**/js/auth.js*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: authStubModule({ canAdmin }),
  }));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/admin/recipients'
      ? { counts: { subscribers: 12, imported: 12 }, recipients: [] }
      : {};
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  return consoleProblems;
}

test('buyer controls optional mail while required service mail stays immutable', async ({ page }) => {
  const consoleProblems = await boot(page, { canAdmin: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${site.baseUrl}/dashboard.html#notifications`, { waitUntil: 'load' });
  await page.locator('[data-panel="notifications"] summary').click();

  const required = page.locator('#transactionalEmailRequired');
  const marketing = page.locator('[data-pref="marketing_email_enabled"]');
  const support = page.locator('[data-pref="notify_messages"]');
  await expect(required).toBeChecked();
  await expect(required).toBeDisabled();
  await expect(marketing).not.toBeChecked();
  await expect(support).toBeChecked();

  await marketing.click();
  await expect(marketing).toBeChecked();
  await expect(page.locator('#notifPrefsStatus')).toHaveText('Email preferences saved.');
  await support.click();
  await expect(support).not.toBeChecked();
  await expect(page.locator('#msgEmailUpdates')).not.toBeChecked();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-email-preferences.png`, fullPage: true });
  expect(consoleProblems).toEqual([]);
});

test('email preferences remain operable at phone width', async ({ page }) => {
  const consoleProblems = await boot(page, { canAdmin: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${site.baseUrl}/dashboard.html#notifications`, { waitUntil: 'load' });
  await page.locator('[data-panel="notifications"] summary').click();
  const marketing = page.locator('[data-pref="marketing_email_enabled"]');
  await marketing.click();
  await expect(marketing).toBeChecked();
  const box = await page.locator('#notifPrefs').boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const labels = await page.locator('#notifPrefs .notif-pref-label').evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { width: rect.width, top: rect.top, bottom: rect.bottom };
  }));
  expect(labels.every((label) => label.width > 200)).toBe(true);
  expect(labels.slice(1).every((label, index) => label.top >= labels[index].bottom)).toBe(true);
  const launcher = await page.locator('.customer-chat__toggle').boundingBox();
  const copies = await page.locator('#notifPrefs .notif-pref-copy').evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  expect(launcher).not.toBeNull();
  expect(copies.some((copy) => copy.left < launcher.x + launcher.width
    && copy.right > launcher.x
    && copy.top < launcher.y + launcher.height
    && copy.bottom > launcher.y)).toBe(false);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-email-preferences-mobile.png` });
  expect(consoleProblems).toEqual([]);
});

test('admin newsletter identifies SES ownership and sends a test email', async ({ page }) => {
  const consoleProblems = await boot(page, { canAdmin: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${site.baseUrl}/admin.html#newsletter`, { waitUntil: 'load' });
  await expect(page.locator('.adm-panel[data-panel="newsletter"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#admNewsletter')).toContainText('Amazon SES campaign');
  await expect(page.locator('#nlAudEstimate')).toContainText('12 eligible recipients');
  await expect(page.locator('#nlBlogPickWrap')).toBeHidden();

  await page.locator('#nlSubject').fill('Field note: VertKleen update');
  await page.getByRole('textbox', { name: 'Body editor' }).fill('Service guidance for this month.');
  await page.locator('[data-nl-action="test_send"]').click();
  const dialog = page.locator('dialog.confirm-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-nl-test-email]').fill('dev@masest.co');
  await dialog.getByRole('button', { name: 'Send test' }).click();
  await expect(page.locator('#nlStatus')).toHaveText('Test email accepted by Amazon SES.');

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
  });
  await page.locator('.adm-panel[data-panel="newsletter"] > .adm-panel-title').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-newsletter-ses.png` });
  expect(consoleProblems).toEqual([]);
});
