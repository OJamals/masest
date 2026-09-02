import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from './playwright-test.mjs';

const PORT = 4337;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('static server did not start');
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, 'exit').then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill('SIGKILL');
  await exitedOnce;
});

async function boot(page) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = 'https://stub.supabase.co';
    window.MASEST_SUPABASE_ANON = 'stub-anon-key';
  });
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route('**/api/admin/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  await page.route('**/api/admin/stats', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      staff_context: {
        email: 'dev@masest.co',
        role: 'owner',
        can_write: true,
        capabilities: ['prospect.write', 'prospect.delete'],
      },
    }),
  }));
  await page.route('**/api/admin/crm/tasks**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }),
  }));
  await page.route('**/api/admin/customers**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ customers: [], total: 0, has_more: false }),
  }));
  await page.route('**/api/admin/crm/contacts**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: [], total: 0, has_more: false }),
  }));
}

test('Prospects filters, opens context, and saves workflow through one CRM surface', async ({ page }) => {
  await boot(page);
  const listCalls = [];
  const updates = [];
  let stage = 'new';
  const organization = {
    id: '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1',
    name: 'Acme Mechanical',
    segment: 'HVAC / Refrigeration',
    city: 'Detroit',
    state: 'MI',
    status: stage,
    priority: 'unassigned',
    marketing_consent: 'unknown',
    outreach_status: 'unreviewed',
    linked_company_id: '86b5e767-8b8f-42fd-8fcb-8f6c0f176b15',
    retention_review_at: '2027-09-02',
    contact_count: 1,
  };

  await page.route('**/api/admin/crm/prospects**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      updates.push(body);
      stage = body.status;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (url.searchParams.get('id')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          prospect: {
            ...organization,
            status: stage,
            general_email: 'info@example.test',
            phone: '313-555-0100',
            source_record_count: 2,
            linked_company: { id: organization.linked_company_id, name: 'Acme customer account', status: 'approved' },
            contacts: [{
              id: '2153285c-f929-4189-a4f9-2afc3a5de58f',
              name: 'Ada Buyer',
              title: 'Procurement',
              email: 'ada@example.test',
              marketing_consent: 'unknown',
              outreach_status: 'unreviewed',
              needs_verification: true,
            }],
          },
        }),
      });
    }
    listCalls.push(Object.fromEntries(url.searchParams));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prospects: [{ ...organization, status: stage }], total: 1, has_more: false }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="prospects"]').click();
  await expect(page.getByRole('heading', { name: 'Pre-account prospects' })).toBeVisible();
  await expect(page.locator('[data-prospect-results]')).toContainText('Acme Mechanical');
  await expect(page.locator('[data-prospect-results]')).toContainText('No bulk marketing');

  await page.getByRole('searchbox', { name: 'Search prospects' }).fill('Acme');
  await page.locator('[data-prospect-status]').selectOption('new');
  await page.locator('[data-prospect-form]').getByRole('button', { name: 'Filter' }).click();
  await expect.poll(() => listCalls.at(-1)).toMatchObject({ q: 'Acme', status: 'new', limit: '25', offset: '0' });

  await page.locator('[data-prospect-open]').click();
  await expect(page.getByRole('heading', { name: 'Acme Mechanical' })).toBeVisible();
  await expect(page.locator('.crm-prospect-detail')).toContainText('Ada Buyer');
  await expect(page.locator('.crm-prospect-detail')).toContainText('Marketing unknown · outreach unreviewed');
  await expect(page.locator('[data-prospect-open-company]')).toHaveText(/Open customer account/);

  await page.locator('[data-prospect-update] select[name="status"]').selectOption('qualified');
  await page.locator('[data-prospect-update]').getByRole('button', { name: 'Save workflow' }).click();
  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toMatchObject({ id: organization.id, status: 'qualified', priority: 'unassigned' });
  await expect(page.locator('[data-prospect-update] select[name="status"]')).toHaveValue('qualified');
  await expect(page.locator('[data-prospect-update-status]')).toHaveText('Workflow saved.');
});

test('Prospect list stays inside a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.route('**/api/admin/crm/prospects**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      prospects: [{
        id: '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1', name: 'A deliberately long prospect organization name',
        segment: 'HVAC / Refrigeration', city: 'Detroit', state: 'MI', status: 'new', priority: 'high',
        marketing_consent: 'unknown', outreach_status: 'unreviewed', contact_count: 4,
      }],
      total: 1,
      has_more: false,
    }),
  }));
  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="prospects"]').click();
  await expect(page.locator('.crm-prospect-card')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
