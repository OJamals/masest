// Cross-repository proof: actual JS signer -> Python boundary -> native PostgreSQL.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test, expect } from './playwright-test.mjs';
import { waitForHttpServer } from './test-http-server.mjs';
import { handleConnectedCrm } from '../functions/_lib/connected-crm.js';

const base = 'http://127.0.0.1:4327';
const apiBase = 'http://127.0.0.1:8796';
const workspace = randomUUID();
function fixtureFetch(target, options) {
  const destination = new URL(target);
  // Node fetch rewrites Host to the loopback URL. Use an explicit HTTP request
  // only in this fixture so production Host validation stays enabled.
  return new Promise((resolve, reject) => {
    const request = httpRequest(apiBase + destination.pathname + destination.search, {
      method: options.method, signal: options.signal,
      headers: { ...options.headers, Host: 'crm.example.test' },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      response.on('error', reject);
    });
    request.on('error', reject); request.end(options.body);
  });
}
const env = {
  MASEST_CRM_ENABLED: '1', MASEST_CRM_ORIGIN: 'https://crm.example.test',
  MASEST_CRM_ISSUER: 'https://masest.example.test', MASEST_CRM_WORKSPACE_ID: workspace,
  MASEST_CRM_SIGNING_KEY: '12'.repeat(32),
};
let site; let api;
test.beforeAll(async () => {
  const root = process.env.OPENGTM_TEST_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('OPENGTM_TEST_ROOT must name the OpenGTM checkout');
  for (const url of [base, apiBase]) {
    expect(await fetch(url).catch(() => null), 'Do not adopt an existing server').toBeNull();
  }
  site = spawn('python3', ['-m', 'http.server', '4327', '--bind', '127.0.0.1'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
  api = spawn(path.join(root, '.venv/bin/python'), ['-m', 'tests.connected_fixture_server'], { cwd: root, env: { ...process.env, CRM_TEST_WORKSPACE: workspace }, stdio: 'ignore' });
  await waitForHttpServer(`${base}/admin.html`);
  await expect.poll(async () => (await fetch(apiBase).catch(() => null))?.status, { timeout: 15000 }).toBe(400);
});
test.afterAll(async () => {
  for (const child of [site, api]) {
    if (!child || child.exitCode !== null) continue;
    const ended = once(child, 'exit'); child.kill();
    await ended;
  }
});

async function boot(page, { role = 'owner', disabled = false, loseReceipt = false, view = 'intake', holdReceipt = null, holdRead = null, directory = null } = {}) {
  const bodies = []; const errors = []; let lost = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.MASEST_SUPABASE_URL = 'https://stub.supabase.co'; window.MASEST_SUPABASE_ANON = 'stub-anon-key'; });
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({ json: { data: { session: null }, session: null } }));
  await page.route('**/api/admin/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/admin/stats', (route) => route.fulfill({ json: { staff_context: { email: 'staff@example.test', role } } }));
  await page.route('**/api/admin/connected-crm**', async (route) => {
    const incoming = route.request(); const url = new URL(incoming.url());
    const body = incoming.postData();
    if (body) bodies.push(body);
    const request = new Request(env.MASEST_CRM_ISSUER + url.pathname + url.search, {
      method: incoming.method(), ...(body ? { body } : {}), headers: { 'Content-Type': 'application/json' },
    });
    const response = await handleConnectedCrm({ request, env: disabled ? {} : env }, {
      requireStaff: async () => ({ user: { id: '00000000-0000-4000-8000-000000000042' }, staff: true, role }),
      staffDirectory: directory || { list: async () => ({ items: [], next_cursor: null }), eligible: async () => false },
      fetch: fixtureFetch,
    });
    if (body && loseReceipt && !lost && response.ok) { lost = true; await route.abort('failed'); return; }
    if (body && holdReceipt) await holdReceipt(await response.clone().json());
    if (!body && holdRead) await holdRead(url.searchParams, await response.clone().json());
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto(`${base}/admin.html?crm_view=${view}#crm`);
  return { bodies, errors };
}

test('Admin imports into independent PostgreSQL and retries a lost receipt without duplicates', async ({ page }) => {
  const { bodies, errors } = await boot(page, { loseReceipt: true });
  await expect(page.getByRole('heading', { name: 'CRM intake' })).toBeVisible();
  await page.getByLabel('CSV file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('source_id,company_id,company,name,email\np1,c1,Synthetic Company,Synthetic Buyer,buyer@example.test\np2,c1,Synthetic Company,,invalid') });
  await page.getByLabel('Source', { exact: true }).fill('synthetic-browser');
  await page.getByLabel('Permitted use', { exact: true }).fill('Synthetic verification only');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same import' })).toBeVisible();
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await page.locator('[data-crm-ws-tab="intake"]').click();
  await expect(page.getByRole('button', { name: 'Retry same import' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry same import' }).click();
  await expect(page.locator('[data-intake-result]')).toContainText('1 accepted');
  await expect(page.locator('[data-intake-result]')).toContainText('1 rejected');
  await expect(page.locator('[data-intake-result]')).toContainText('Row 3');
  await expect(page.locator('[data-intake-people] .crm-contact')).toHaveCount(1);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await page.getByRole('searchbox', { name: 'Search CRM intake' }).fill('Absent');
  await page.locator('[data-intake-search]').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('[data-intake-people]')).toContainText('No prospects match');
  expect(errors.filter((message) => !message.includes('Failed to fetch'))).toEqual([]);
});

test('read-only staff can browse but cannot import', async ({ page }) => {
  await boot(page, { role: 'read_only' });
  await expect(page.getByRole('heading', { name: 'CRM intake' })).toBeVisible();
  await expect(page.getByLabel('CSV file')).toHaveCount(0);
  await expect(page.locator('[data-intake-list-status]')).toContainText('prospects shown.');
});

test('disabled bridge gives an honest unavailable state without import controls', async ({ page }) => {
  await boot(page, { disabled: true });
  await expect(page.locator('[data-crm-ws-body]')).toContainText('not connected yet');
  await expect(page.getByLabel('CSV file')).toHaveCount(0);
});

test('whitespace provenance never submits, and invalid UTF-8 cannot reuse an earlier file', async ({ page }) => {
  const { bodies } = await boot(page);
  const file = page.getByLabel('CSV file');
  await file.setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from('source_id,company_id,company,name\np1,c1,Synthetic,Synthetic') });
  await page.getByLabel('Source', { exact: true }).fill('   ');
  await page.getByLabel('Permitted use', { exact: true }).fill('Synthetic test');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.locator('[data-intake-result]')).toContainText('Enter a source');
  expect(bodies).toHaveLength(0);
  await file.setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from([0xff]) });
  await expect(page.locator('[data-intake-file]')).toContainText('UTF-8');
  await expect(page.getByRole('button', { name: 'Import CSV', exact: true })).toBeDisabled();
});

test('intake remains usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.getByLabel('CSV file')).toBeVisible();
  await expect(page.locator('[data-intake-list-status]')).toContainText('prospects shown.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Source', { exact: true }).focus();
  await expect(page.getByLabel('Source', { exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(process.env.OPENGTM_TEST_ROOT, '.runtime/masest-crm-intake-mobile.png'), fullPage: true });
});

async function seedDossier(name) {
  const source = 'synthetic-review-' + randomUUID();
  const response = await handleConnectedCrm({ env, request: new Request(env.MASEST_CRM_ISSUER + '/api/admin/connected-crm?resource=imports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action_id: randomUUID(), source, permitted_use: 'Synthetic review only',
      csv_text: `source_id,company_id,company,name,email\np1,c1,Synthetic Review Company,${name},review@example.test`,
    }),
  }) }, { requireStaff: async () => ({ user: { id: '00000000-0000-4000-8000-000000000042' }, staff: true, role: 'owner' }), fetch: fixtureFetch });
  expect(response.status).toBe(200);
  const person = (await response.json()).person_ids[0];
  const seed = spawn(path.join(process.env.OPENGTM_TEST_ROOT, '.venv/bin/python'), ['-c', 'import sys; from tests.connected_fixture_server import seed_review; seed_review(sys.argv[1], sys.argv[2])', workspace, person], { cwd: process.env.OPENGTM_TEST_ROOT, stdio: 'ignore' });
  expect((await once(seed, 'exit'))[0]).toBe(0);
  return person;
}

async function salesFixture(resource, body) {
  const response = await handleConnectedCrm({ env, request: new Request(env.MASEST_CRM_ISSUER + '/api/admin/connected-crm?resource=' + resource, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_id: randomUUID(), ...body }),
  }) }, { requireStaff: async () => ({ user: { id: '00000000-0000-4000-8000-000000000042' }, staff: true, role: 'owner' }), fetch: fixtureFetch });
  expect(response.status).toBe(200); return response.json();
}

test('engagement history ignores stale section responses', async ({ page }) => {
  const person = await seedDossier('Stale Engagement Buyer');
  let release; let received = false; const gate = new Promise((resolve) => { release = resolve; });
  await boot(page, { view: 'sales', holdRead: async (params) => {
    if (params.get('resource') === 'sales_engagement' && params.get('section') === 'activities' && params.get('person_id') === person) { received = true; await gate; }
  } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await expect.poll(() => received).toBe(true);
  await page.getByRole('combobox', { name: 'Engagement section', exact: true }).selectOption('preferences');
  await expect(page.locator('[data-history-engagement-status]')).toContainText('No recorded preferences');
  const oldResponse = page.waitForResponse((res) => res.url().includes('sales_engagement') && res.url().includes('activities'));
  release(); await oldResponse;
  await expect(page.locator('[data-history-engagement-status]')).toContainText('No recorded preferences');
});

test('directory paging retries and staff task filter survives workspace navigation', async ({ page }) => {
  const teammate = '00000000-0000-4000-8000-000000000043'; let pageTwo = 0;
  await boot(page, { view: 'sales', directory: {
    list: async ({ cursor }) => {
      if (!cursor) return { items: [], next_cursor: teammate };
      if (++pageTwo === 1) throw new Error('Synthetic directory unavailable');
      return { items: [{ staff_id: teammate, display_name: 'Paged teammate', role: 'support' }], next_cursor: null };
    }, eligible: async () => false,
  } });
  await page.getByRole('button', { name: 'More staff', exact: true }).click();
  await expect(page.locator('[data-staff-status]')).toContainText('unavailable');
  await page.getByRole('button', { name: 'More staff', exact: true }).click();
  await page.getByRole('combobox', { name: 'Task assignment', exact: true }).selectOption(teammate);
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await page.locator('[data-crm-ws-tab="sales"]').click();
  await expect(page.getByRole('combobox', { name: 'Task assignment', exact: true })).toHaveValue(teammate);
  await page.getByRole('button', { name: 'More staff', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Task assignment', exact: true })).toHaveValue(teammate);
});

test('account and engagement history page independently, retry safely and escape notes', async ({ page }) => {
  const person = await seedDossier('History Buyer');
  const seed = spawn(path.join(process.env.OPENGTM_TEST_ROOT, '.venv/bin/python'), ['-c', 'import sys; from tests.connected_fixture_server import seed_engagement; print(seed_engagement(sys.argv[1], sys.argv[2]))', workspace, person], { cwd: process.env.OPENGTM_TEST_ROOT });
  let output = ''; seed.stdout.on('data', (chunk) => { output += chunk; });
  expect((await once(seed, 'exit'))[0]).toBe(0); const organization = output.trim();
  for (let i = 0; i < 12; i++) await salesFixture('sales_tasks', { organization_id: organization, title: 'Account history task ' + i });
  const { errors } = await boot(page, { view: 'sales', role: 'read_only' });
  await page.getByRole('combobox', { name: 'CRM account', exact: true }).selectOption(organization);
  await expect(page.locator('[data-history-account-events] article')).toHaveCount(10);
  await page.getByRole('button', { name: 'More account history', exact: true }).click();
  await expect(page.locator('[data-history-account-events] article')).toHaveCount(12);
  await page.locator('[data-history-account-events]').getByRole('button', { name: 'Open task Account history task 0', exact: true }).click();
  await expect(page.locator('[data-sales-editor]')).toContainText('Task details');
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await expect(page.locator('[data-history-engagement-events] article')).toHaveCount(10);
  const cursors = [];
  await page.route('**/api/admin/connected-crm?resource=sales_engagement**', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor) { cursors.push(cursor); if (cursors.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'synthetic', message: 'Synthetic interruption' } } }); }
    return route.fallback();
  });
  await page.getByRole('button', { name: 'More engagement history', exact: true }).click();
  await expect(page.locator('[data-history-engagement-status]')).toContainText('Synthetic interruption');
  await expect(page.locator('[data-history-engagement-events] article')).toHaveCount(10);
  await page.getByRole('button', { name: 'More engagement history', exact: true }).click();
  await expect(page.locator('[data-history-engagement-events] article')).toHaveCount(12);
  expect(cursors[1]).toBe(cursors[0]);
  await expect(page.locator('[data-history-engagement-events] img')).toHaveCount(0);
  await expect(page.locator('[data-history-engagement-events]')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('[data-history-engagement-events]')).not.toContainText('DO_NOT_EXPOSE');
  await expect(page.locator('[data-history-engagement-events]')).toContainText('Occurred');
  await page.getByRole('heading', { name: 'Prospect engagement history', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/connected-team-history-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('heading', { name: 'Prospect engagement history', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/connected-team-history-mobile.png' });
  for (const section of ['preferences', 'handoffs', 'opportunities']) {
    await page.getByRole('combobox', { name: 'Engagement section', exact: true }).selectOption(section);
    await expect(page.locator('[data-history-engagement-status]')).toContainText('No recorded');
  }
  expect(errors).toEqual([]);
});

test('team assignment survives lost receipt and target revocation, with audited ownership', async ({ page }) => {
  const person = await seedDossier('Team Buyer'); const teammate = '00000000-0000-4000-8000-000000000043';
  let eligible = true;
  const { errors } = await boot(page, { view: 'sales', loseReceipt: true, directory: {
    list: async () => ({ items: [{ staff_id: teammate, display_name: 'Synthetic teammate', role: 'support' }], next_cursor: null }),
    eligible: async (id) => eligible && id === teammate,
  } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  const form = page.locator('[data-sales-create="task"]');
  await form.getByLabel('Task title', { exact: true }).fill('Assigned team review');
  await form.getByRole('combobox', { name: /^Assignment/ }).selectOption(teammate);
  await form.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeVisible();
  eligible = false;
  await page.getByRole('button', { name: 'Retry original change' }).click();
  await expect(page.locator('[data-sales-editor]')).toContainText('Synthetic teammate');
  await expect(page.locator('[data-sales-history]')).toContainText('Task created');
  await page.getByRole('combobox', { name: 'Task assignment', exact: true }).selectOption(teammate);
  await expect(page.locator('[data-sales-tasks]')).toContainText('Assigned team review');
  const editor = page.locator('[data-sales-editor]');
  await editor.getByRole('combobox', { name: /^Assignment/ }).selectOption(teammate);
  await editor.getByLabel('Reason', { exact: true }).fill('Check revoked target');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('[data-sales-status]')).toContainText('currently eligible');
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeHidden();
  await editor.getByRole('combobox', { name: /^Assignment/ }).selectOption('clear');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toContainText('Unassigned');
  expect(errors.filter((value) => !value.includes('Failed to fetch'))).toEqual([]);
});

test('connected daily work filters tasks and pages prospect sales history with read-only access', async ({ page }) => {
  const person = await seedDossier('Daily Buyer');
  const past = new Date(Date.now() - 86400000).toISOString();
  await salesFixture('sales_tasks', { person_id: person, title: 'Daily mine overdue', due_at: past, priority: 'high', owner_staff_id: '00000000-0000-4000-8000-000000000042' });
  await salesFixture('sales_tasks', { person_id: person, title: 'Daily unassigned overdue', due_at: past });
  for (let i = 0; i < 10; i++) await salesFixture('sales_tasks', { person_id: person, title: 'Daily unscheduled ' + i });
  await boot(page, { view: 'sales', role: 'read_only' });
  await expect(page.locator('[data-daily-summary]')).toContainText('Overdue');
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByRole('combobox', { name: 'Task scope', exact: true }).selectOption('prospect');
  await page.getByRole('combobox', { name: 'Task assignment', exact: true }).selectOption('mine');
  await page.getByRole('combobox', { name: 'Task due', exact: true }).selectOption('overdue');
  await expect(page.locator('[data-sales-tasks] [data-sales-open]')).toHaveCount(1);
  await expect(page.locator('[data-sales-tasks]')).toContainText('Daily mine overdue');
  await page.getByRole('combobox', { name: 'Task assignment', exact: true }).selectOption('unassigned');
  await expect(page.locator('[data-sales-tasks]')).toContainText('Daily unassigned overdue');
  await page.getByRole('combobox', { name: 'Task due', exact: true }).selectOption('unscheduled');
  await expect(page.locator('[data-sales-tasks] [data-sales-open]')).toHaveCount(10);
  await expect(page.locator('[data-daily-events] article')).toHaveCount(10);
  await page.getByRole('button', { name: 'More prospect activity' }).click();
  await expect(page.locator('[data-daily-events] article')).toHaveCount(12);
  await page.locator('[data-daily-events]').getByRole('button', { name: 'Open task Daily mine overdue' }).click();
  await expect(page.locator('[data-sales-editor]').getByLabel('Title', { exact: true })).toHaveValue('Daily mine overdue');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/connected-daily-work-mobile.png', fullPage: true });
});

test('connected daily work ignores a stale prospect timeline after selection changes', async ({ page }) => {
  const first = await seedDossier('Old Timeline Buyer'); const second = await seedDossier('Current Timeline Buyer');
  await salesFixture('sales_tasks', { person_id: first, title: 'Old timeline work' });
  await salesFixture('sales_tasks', { person_id: second, title: 'Current timeline work' });
  let release; let received = false; const gate = new Promise((resolve) => { release = resolve; });
  await boot(page, { view: 'sales', holdRead: async (params) => {
    if (params.get('resource') === 'sales_timeline' && params.get('person_id') === first) { received = true; await gate; }
  } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(first);
  await expect.poll(() => received).toBe(true);
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(second);
  await expect(page.locator('[data-daily-events]')).toContainText('Current timeline work');
  const oldResponse = page.waitForResponse((res) => res.url().includes('sales_timeline') && res.url().includes(first));
  release(); await oldResponse;
  await expect(page.locator('[data-daily-events]')).not.toContainText('Old timeline work');
});

test('connected daily work ignores old task filters and retries history paging without losing rows', async ({ page }) => {
  const person = await seedDossier('Paging Buyer');
  for (let i = 0; i < 12; i++) await salesFixture('sales_tasks', { person_id: person, title: 'Paging open ' + i });
  const completed = await salesFixture('sales_tasks', { person_id: person, title: 'Paging completed' });
  await salesFixture('sales_task&record_id=' + completed.id, { expected_revision: 1, status: 'completed', reason: 'Synthetic completion' });
  let release; let held = false; const gate = new Promise((resolve) => { release = resolve; });
  await boot(page, { view: 'sales', role: 'read_only', holdRead: async (params) => {
    if (params.get('resource') === 'sales_tasks' && params.get('status') === 'completed') { held = true; await gate; }
  } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByRole('combobox', { name: 'Task scope', exact: true }).selectOption('prospect');
  await page.getByRole('combobox', { name: 'Task status', exact: true }).selectOption('completed');
  await expect.poll(() => held).toBe(true);
  await page.getByRole('combobox', { name: 'Task status', exact: true }).selectOption('open');
  await expect(page.locator('[data-sales-tasks] [data-sales-open]')).toHaveCount(12);
  const oldResponse = page.waitForResponse((res) => res.url().includes('sales_tasks') && res.url().includes('status=completed'));
  release(); await oldResponse;
  await expect(page.locator('[data-sales-tasks]')).not.toContainText('Paging completed');
  const cursors = [];
  await page.route('**/api/admin/connected-crm?resource=sales_timeline**', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor) {
      cursors.push(cursor);
      if (cursors.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'synthetic_unavailable', message: 'Synthetic history interruption' } } });
    }
    return route.fallback();
  });
  await expect(page.locator('[data-daily-events] article')).toHaveCount(10);
  await page.getByRole('button', { name: 'More prospect activity' }).click();
  await expect(page.locator('[data-daily-timeline-status]')).toContainText('Synthetic history interruption');
  await expect(page.locator('[data-daily-events] article')).toHaveCount(10);
  await page.getByRole('button', { name: 'More prospect activity' }).click();
  await expect(page.locator('[data-daily-events] article')).toHaveCount(14);
  expect(cursors[1]).toBe(cursors[0]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/connected-daily-work-viewport.png' });
});

test('connected sales task survives lost receipt and reload, then completes with staff history', async ({ page }) => {
  const person = await seedDossier('Task Buyer');
  const { bodies, errors } = await boot(page, { view: 'sales', loseReceipt: true });
  await expect(page.getByRole('heading', { name: 'Sales workspace', exact: true })).toBeVisible();
  await expect(page.locator('[data-sales-prospect]')).toBeVisible();
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByLabel('Task title', { exact: true }).fill('Synthetic follow-up');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry original change' }).click();
  await expect(page.locator('[data-sales-tasks]').getByRole('button', { name: 'Open task Synthetic follow-up' })).toHaveCount(1);
  expect(bodies[1]).toBe(bodies[0]);
  await page.locator('[data-sales-tasks]').getByRole('button', { name: 'Open task Synthetic follow-up' }).click();
  const editor = page.locator('[data-sales-editor]');
  await editor.getByRole('combobox', { name: 'Status', exact: true }).selectOption('completed');
  await editor.getByLabel('Reason', { exact: true }).fill('Synthetic review complete');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toContainText('Revision 2');
  await expect(page.locator('[data-sales-history]')).toContainText('Synthetic review complete');
  await expect(page.locator('[data-sales-history]')).toContainText('owner');
  expect(errors.filter((message) => !message.includes('Failed to fetch'))).toEqual([]);
});

test('connected sales pipeline and deal persist through board and enforce read-only UI', async ({ page }) => {
  const person = await seedDossier('Deal Buyer');
  await boot(page, { view: 'sales' });
  await page.getByLabel('Pipeline name', { exact: true }).fill('Synthetic browser pipeline');
  await page.getByRole('button', { name: 'Create pipeline', exact: true }).click();
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByLabel('Deal title', { exact: true }).fill('Synthetic contract');
  await page.getByLabel('Amount', { exact: true }).fill('500.25');
  await page.getByRole('button', { name: 'Create deal', exact: true }).click();
  await expect(page.locator('[data-sales-board]')).toContainText('Synthetic contract');
  await page.locator('[data-sales-board]').getByRole('button', { name: 'Open deal Synthetic contract' }).click();
  const editor = page.locator('[data-sales-editor]');
  await editor.getByRole('combobox', { name: 'Stage', exact: true }).selectOption({ label: 'Won' });
  await editor.getByLabel('Close reason', { exact: true }).fill('Synthetic acceptance');
  await editor.getByLabel('Reason', { exact: true }).fill('Synthetic stage change');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toContainText('Revision 2');
  await expect(page.locator('[data-sales-board]')).toContainText('500.25 USD');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/connected-sales-mobile.png', fullPage: true });
  await page.unroute('**/api/admin/connected-crm**');
  await page.goto('about:blank');
  await boot(page, { view: 'sales', role: 'read_only' });
  await expect(page.getByRole('heading', { name: 'Sales workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create deal', exact: true })).toHaveCount(0);
});

test('connected sales reconciles a committed request after leaving and reopening its tab', async ({ page }) => {
  const person = await seedDossier('Tab Buyer'); let release; let received = false;
  const gate = new Promise((resolve) => { release = resolve; });
  await boot(page, { view: 'sales', holdReceipt: async () => { received = true; await gate; } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByLabel('Task title', { exact: true }).fill('Tab follow-up');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await page.locator('[data-crm-ws-tab="sales"]').click();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeEnabled();
  await expect(page.locator('[data-sales-tasks]').getByRole('button', { name: 'Open task Tab follow-up', exact: true })).toHaveCount(1);
});

test('connected sales preserves rejection reason across tab switches without claiming success', async ({ page }) => {
  const person = await seedDossier('Rejected Buyer'); let release; let failure;
  const gate = new Promise((resolve) => { release = resolve; });
  await boot(page, { view: 'sales', holdReceipt: async (receipt) => { failure = receipt.error.message; await gate; } });
  await page.getByRole('combobox', { name: 'Prospect', exact: true }).selectOption(person);
  await page.getByLabel('Task title', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect.poll(() => Boolean(failure)).toBe(true);
  await page.locator('[data-crm-ws-tab="contacts"]').click();
  await page.locator('[data-crm-ws-tab="sales"]').click();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeVisible();
  release();
  await expect(page.locator('[data-sales-status]')).toHaveText(failure);
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry original change' })).toBeHidden();
});

test('read-only dossier shows bounded provenance and evidence without losing the search', async ({ page }) => {
  await seedDossier('Dossier Buyer');
  const { errors } = await boot(page, { role: 'read_only' });
  const search = page.getByRole('searchbox', { name: 'Search CRM intake' });
  await search.fill('Dossier Buyer');
  await page.locator('[data-intake-search]').getByRole('button', { name: 'Search', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Review Dossier Buyer', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Prospect dossier' });
  await expect(dialog).toContainText('Dossier Buyer');
  await expect(dialog).toContainText('Eligibility: unknown');
  await dialog.getByRole('button', { name: 'Source evidence', exact: true }).click();
  await expect(dialog.locator('[data-review-record]')).toHaveCount(10);
  await expect(dialog).toContainText('Synthetic review only');
  await expect(dialog.locator('img')).toHaveCount(0);
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Load more source evidence' }).click();
  await expect(dialog.locator('[data-review-record]')).toHaveCount(20);
  await dialog.getByRole('button', { name: 'Assertions', exact: true }).click();
  await expect(dialog).toContainText('inferred');
  await expect(dialog).toContainText('retracted');
  await expect(dialog).toContainText('conflicting');
  await expect(dialog).toContainText('expired');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await dialog.screenshot({ path: path.join(process.env.OPENGTM_TEST_ROOT, '.runtime/masest-crm-review-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue('Dossier Buyer');
  expect(errors).toEqual([]);
});

test('dossier retries preserve pages and closed-dialog replies cannot replace the reopened record', async ({ page }) => {
  await seedDossier('Retry Buyer');
  const { errors } = await boot(page, { role: 'read_only' });
  let failed = false;
  const cursors = [];
  let release; let received;
  const delayed = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { received = resolve; });
  await page.route('**/api/admin/connected-crm**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('resource') === 'evidence' && params.has('cursor')) {
      cursors.push(params.get('cursor'));
      if (!failed) {
        failed = true;
        await route.fulfill({ status: 502, json: { error: { code: 'crm_unavailable', message: 'Synthetic page failure' } } });
        return;
      }
    }
    if (params.get('resource') === 'assertions') { received(); await delayed; }
    await route.fallback();
  });
  const trigger = page.getByRole('button', { name: 'Review Retry Buyer', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Prospect dossier' });
  await expect(dialog).toContainText('Eligibility: unknown');
  await dialog.getByRole('button', { name: 'Source evidence', exact: true }).click();
  await expect(dialog.locator('[data-review-record]')).toHaveCount(10);
  await dialog.getByRole('button', { name: 'Load more source evidence' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Synthetic page failure');
  await expect(dialog.locator('[data-review-record]')).toHaveCount(10);
  await dialog.getByRole('button', { name: 'Retry source evidence' }).click();
  await expect(dialog.locator('[data-review-record]')).toHaveCount(20);
  expect(cursors).toHaveLength(2); expect(cursors[1]).toBe(cursors[0]);
  await dialog.getByRole('button', { name: 'Assertions', exact: true }).click();
  await requested;
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(dialog).toContainText('Eligibility: unknown');
  const response = page.waitForResponse((result) => new URL(result.url()).searchParams.get('resource') === 'assertions');
  release(); await response;
  await expect(dialog.locator('[data-review-record]')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Contacts', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
