import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from './playwright-test.mjs';
import { waitForHttpServer } from './test-http-server.mjs';

const PORT = 4337;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  await waitForHttpServer(`${BASE_URL}/admin.html`);
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
        capabilities: ['prospect.write', 'prospect.delete', 'company.credit'],
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
  const outreachWrites = [];
  const outreachDrafts = [];
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

  await page.route('**/api/admin/crm/outreach-drafts**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    outreachWrites.push({ method: request.method(), body });
    if (request.method() === 'POST') {
      const draft = {
        id: '7c8feec6-3c73-46e6-b275-034a34e62f7c',
        ...body,
        status: 'draft',
        created_at: '2026-09-09T12:00:00Z',
        updated_at: '2026-09-09T12:00:00Z',
      };
      outreachDrafts.unshift(draft);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, draft }) });
    }
    const draft = outreachDrafts.find((entry) => entry.id === body.id);
    draft.status = body.action === 'approve' ? 'approved' : body.action;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draft }) });
  });

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
            website: 'https://example.test/providers',
            source_record_count: 2,
            outreach_drafts: outreachDrafts,
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

  await page.locator('[data-prospect-outreach-form] textarea[name="compliance_basis"]').fill('Public provider page; procurement role is relevant to facility cleaning.');
  await page.locator('[data-prospect-outreach-form]').getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => outreachWrites.length).toBe(1);
  expect(outreachWrites[0]).toMatchObject({
    method: 'POST',
    body: {
      organization_id: organization.id,
      contact_id: null,
      recipient_email: 'info@example.test',
      source_url: 'https://example.test/providers',
    },
  });
  await expect(page.locator('.crm-outreach-card')).toContainText('draft');

  await page.locator('[data-outreach-action="approve"]').click();
  await expect.poll(() => outreachWrites.length).toBe(2);
  await expect(page.locator('.crm-outreach-card')).toContainText('approved');
  await expect(page.locator('[data-outreach-open]')).toHaveAttribute('href', /^mailto:info%40example\.test\?subject=/);

  await page.locator('[data-outreach-action="sent"]').click();
  await expect.poll(() => outreachWrites.length).toBe(3);
  await expect(page.locator('.crm-outreach-card')).toContainText('sent');

  await page.locator('[data-outreach-action="replied"]').click();
  await expect.poll(() => outreachWrites.length).toBe(4);
  await expect(page.locator('.crm-outreach-card')).toContainText('replied');

  await page.locator('[data-outreach-action="opted_out"]').click();
  await page.locator('.confirm-dialog button[value="confirm"]').click();
  await expect.poll(() => outreachWrites.length).toBe(5);
  await expect(page.locator('.crm-outreach-card')).toContainText('opted out');
  await expect(page.locator('.crm-outreach')).toContainText('Future outreach blocked.');
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

test('Unlinked Prospect searches and links an existing customer account', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const prospectId = '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1';
  const companyId = '86b5e767-8b8f-42fd-8fcb-8f6c0f176b15';
  const patches = [];
  let linkedCompany = null;
  let releasePatch;
  const patchGate = new Promise((resolve) => { releasePatch = resolve; });

  await page.route('**/api/admin/crm/prospects**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      patches.push(body);
      await patchGate;
      linkedCompany = { id: body.linked_company_id, name: 'Acme customer account', status: 'approved' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (url.searchParams.get('id')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          prospect: {
            id: prospectId,
            name: 'Acme Mechanical',
            segment: 'HVAC / Refrigeration',
            status: 'qualified',
            priority: 'normal',
            general_email: 'info@example.test',
            phone: '(313) 555-0100',
            website: 'example.test',
            marketing_consent: 'unknown',
            outreach_status: 'unreviewed',
            linked_company_id: linkedCompany?.id || null,
            linked_company: linkedCompany,
            contacts: [],
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prospects: [{
        id: prospectId, name: 'Acme Mechanical', status: 'qualified', priority: 'normal',
        marketing_consent: 'unknown', outreach_status: 'unreviewed', contact_count: 0,
      }], total: 1, has_more: false }),
    });
  });
  await page.route('**/api/admin/companies**', (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('search')).toBe('Acme Mechanical');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ companies: [{ id: companyId, name: 'Acme customer account', status: 'approved' }], total: 1 }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="prospects"]').click();
  await page.locator('[data-prospect-open]').click();
  await expect(page.locator('[data-prospect-channel="email"]')).toHaveAttribute('href', 'mailto:info%40example.test');
  await expect(page.locator('[data-prospect-channel="phone"]')).toHaveAttribute('href', 'tel:+13135550100');
  await expect(page.locator('[data-prospect-channel="website"]')).toHaveAttribute('href', 'https://example.test/');

  await page.locator('[data-prospect-link-toggle]').click();
  await expect(page.locator('[data-prospect-link-panel]')).toBeVisible();
  await expect(page.locator('[data-prospect-company-search] input[name="query"]')).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('[data-prospect-company-search]').getByRole('button', { name: 'Search accounts' }).click();
  await expect(page.locator('[data-prospect-company-results]')).toContainText('Acme customer account');
  await page.locator('[data-prospect-link-company]').click();

  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ id: prospectId, linked_company_id: companyId });
  await page.locator('[data-prospect-back]').click();
  releasePatch();
  await expect(page.getByRole('heading', { name: 'Pre-account prospects' })).toBeVisible();
  await expect(page.locator('.crm-prospect-detail')).toHaveCount(0);
  await page.locator('[data-prospect-open]').click();
  await expect(page.locator('[data-prospect-open-company]')).toHaveText('Open customer account');
});

test('Unlinked Prospect creates one pending account and recovers a failed auto-link without email', async ({ page }) => {
  await boot(page);
  const prospectId = '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1';
  const companyId = '86b5e767-8b8f-42fd-8fcb-8f6c0f176b15';
  const companyCreates = [];
  const prospectPatches = [];
  let linkedCompany = null;

  await page.route('**/api/admin/crm/prospects**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      prospectPatches.push(body);
      if (prospectPatches.length === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error' }) });
      }
      linkedCompany = { id: body.linked_company_id, name: 'Acme Mechanical', status: 'pending' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (url.searchParams.get('id')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prospect: {
          id: prospectId, name: 'Acme Mechanical', status: 'qualified', priority: 'normal',
          marketing_consent: 'unknown', outreach_status: 'unreviewed', linked_company_id: linkedCompany?.id || null,
          linked_company: linkedCompany, contacts: [],
        } }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ prospects: [{
        id: prospectId, name: 'Acme Mechanical', status: 'qualified', priority: 'normal',
        marketing_consent: 'unknown', outreach_status: 'unreviewed', contact_count: 0,
      }], total: 1, has_more: false }),
    });
  });
  await page.route('**/api/admin/companies**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ companies: [{ id: companyId, name: 'Acme Mechanical', status: 'pending' }], total: 1 }),
      });
    }
    const body = route.request().postDataJSON();
    companyCreates.push(body);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ company: { id: companyId, name: 'Acme Mechanical', status: 'pending' } }),
    });
  });

  await page.goto(`${BASE_URL}/admin.html#crm`);
  await page.locator('[data-crm-ws-tab="prospects"]').click();
  await page.locator('[data-prospect-open]').click();
  await page.locator('[data-prospect-link-toggle]').click();
  await expect(page.locator('[data-prospect-link-panel]')).toContainText('No user is invited and no email is sent.');
  await page.locator('[data-prospect-company-create]').getByRole('button', { name: 'Create pending account' }).click();

  await expect.poll(() => companyCreates.length).toBe(1);
  expect(companyCreates[0]).toEqual({ action: 'create_company', name: 'Acme Mechanical', status: 'pending' });
  await expect.poll(() => prospectPatches.length).toBe(1);
  expect(prospectPatches[0]).toEqual({ id: prospectId, linked_company_id: companyId });
  await expect(page.locator('[data-prospect-company-create] button[type="submit"]')).toBeDisabled();
  await expect(page.locator('[data-prospect-company-create-status]')).toContainText('Account created, but linking failed.');
  await page.locator('[data-prospect-company-search]').getByRole('button', { name: 'Search accounts' }).click();
  await page.locator('[data-prospect-link-company]').click();
  await expect.poll(() => prospectPatches.length).toBe(2);
  expect(companyCreates).toHaveLength(1);
  await expect(page.locator('[data-prospect-open-company]')).toHaveText('Open customer account');
  await expect(page.locator('[data-prospect-update-status]')).toHaveText('Customer account linked.');
});
