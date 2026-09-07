import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from './playwright-test.mjs';
import { waitForHttpServer } from './test-http-server.mjs';

const PORT = 4340;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = new URL('../artifacts/support-ticket-queue/after/', import.meta.url).pathname;
const TICKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
let server;

const rawTicket = {
  id: TICKET_ID,
  display_number: 'MAS-000042',
  subject: 'Damaged pail on delivery',
  status: 'open',
  priority: 'high',
  category: 'order',
  version: 4,
  assigned_to: null,
  company_id: 'company-1',
  participant_id: USER_ID,
  thread_id: '11111111-1111-4111-8111-111111111111',
  primary_order_id: ORDER_ID,
  last_message_at: '2026-09-06T14:00:00.123456+00:00',
};
const queueTicket = {
  ...rawTicket,
  participant: { id: USER_ID, name: 'Avery Buyer' },
  company: { id: rawTicket.company_id, name: 'Acme HVAC' },
  order: { id: ORDER_ID, reference: 'MST-2042', status: 'delivered' },
};

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true });
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

async function boot(page, { tickets = [queueTicket], replyConflict = false, onPost = null } = {}) {
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
      staff_context: { email: 'staff@masest.test', role: 'owner', capabilities: ['admin.write'] },
      crm: { unread_messages: 1 },
    }),
  }));
  await page.route('**/api/admin/message-settings', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ notify_admin_support_requests: true, notify_admin_messages: true }),
  }));
  await page.route('**/api/admin/customers?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ customers: [{ id: USER_ID, full_name: 'Avery Buyer', email: 'avery@example.test', company_name: 'Acme HVAC' }] }),
  }));
  await page.route('**/api/admin/users?detail=**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: { id: USER_ID, full_name: 'Avery Buyer', email: 'avery@example.test' },
      company: { id: rawTicket.company_id, name: 'Acme HVAC' },
      orders: [{ id: ORDER_ID, order_number: 'MST-2042', status: 'delivered' }],
    }),
  }));
  await page.route('**/api/admin/messages**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      onPost?.(request.postDataJSON());
      if (replyConflict) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'ticket_version_conflict' }) });
      }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ticket_id: TICKET_ID, ticket: rawTicket }) });
    }
    if (url.searchParams.get('summary') === '1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: { open: 1, needs_reply: 1, mine: 0, unassigned: 1, waiting: 0, resolved: 0 } }) });
    }
    if (url.searchParams.get('view') === 'assignees') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assignees: [] }) });
    }
    if (url.searchParams.get('ticket_id') === TICKET_ID) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ticket: rawTicket,
          thread: { id: rawTicket.thread_id, participant: { id: USER_ID, full_name: 'Avery Buyer' }, company_id: rawTicket.company_id, company_name: 'Acme HVAC' },
          order_scope: { ...queueTicket.order, admin_url: `/admin.html?order=${ORDER_ID}#orders` },
          messages: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sender_role: 'buyer', body: 'One pail arrived damaged.', created_at: rawTicket.last_message_at }],
          has_more: false,
          next_message_cursor: null,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tickets,
        summary: { open: tickets.length, needs_reply: tickets.length, mine: 0, unassigned: tickets.length, waiting: 0, resolved: 0 },
        has_more: false,
        next_cursor: null,
      }),
    });
  });
}

test('captures the settled 042 ticket queue and exact detail at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await boot(page);
  await page.goto(`${BASE_URL}/admin.html#support`);
  await expect(page.locator('[data-support-ticket-id]')).toHaveCount(1);
  await expect(page.locator('[data-support-ticket-id]')).toContainText('MAS-000042');
  await page.screenshot({ path: `${ARTIFACTS}/admin-desktop-queue.png` });
  await page.locator('[data-support-ticket-id]').click();
  await expect(page.locator('.site-support__ticket-head')).toContainText('Damaged pail on delivery');
  await expect(page.locator('.site-support__ticket-head')).toContainText('Avery Buyer');
  await expect(page.locator('.site-support__messages')).toContainText('One pail arrived damaged.');
  await page.screenshot({ path: `${ARTIFACTS}/admin-desktop-detail.png` });
});

test('captures the settled 042 new-ticket composer at an exact 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.goto(`${BASE_URL}/admin.html#support`);
  await page.locator('[data-support-new-ticket]').click();
  await page.locator('[data-support-recipient-search]').fill('Avery');
  await page.getByRole('button', { name: /Avery Buyer/ }).click();
  await expect(page.locator('[name="subject"]')).toBeFocused();
  await expect(page.locator('[name="order_id"]')).toContainText('MST-2042');
  await page.locator('[name="subject"]').fill('Replacement needed');
  await page.locator('.site-support__composer [name="body"]').fill('Please arrange a replacement pail.');
  expect(await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ width: 390, client: 390, scroll: 390 });
  await page.screenshot({ path: `${ARTIFACTS}/admin-mobile-390-compose.png` });
});

test('captures the settled new-ticket composer at an exact 320px viewport', async ({ page }) => {
  let posted = null;
  await page.setViewportSize({ width: 320, height: 700 });
  await boot(page, { onPost: (body) => { posted = body; } });
  await page.goto(`${BASE_URL}/admin.html#support`);
  await page.locator('[data-support-new-ticket]').click();
  await page.locator('[data-support-recipient-search]').fill('Avery');
  await page.getByRole('button', { name: /Avery Buyer/ }).click();
  await expect(page.locator('.site-support__recipient')).toContainText('Avery Buyer');
  await page.locator('[name="subject"]').fill('Replacement needed');
  await page.locator('.site-support__composer [name="body"]').fill('Please arrange a replacement pail.');
  const start = page.getByRole('button', { name: 'Start ticket' });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeVisible();
  expect(await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ width: 320, client: 320, scroll: 320 });
  expect(await start.evaluate((button) => {
    const buttonBox = button.getBoundingClientRect();
    const drawerBox = button.closest('.site-support__drawer').getBoundingClientRect();
    return buttonBox.top >= drawerBox.top && buttonBox.bottom <= drawerBox.bottom;
  })).toBe(true);
  await page.screenshot({ path: `${ARTIFACTS}/admin-mobile-320-compose.png` });
  await start.click();
  await expect.poll(() => posted).toEqual({
    action: 'start_ticket',
    recipient_user_id: USER_ID,
    subject: 'Replacement needed',
    category: 'general',
    body: 'Please arrange a replacement pail.',
  });
});

test('captures a truthful empty queue without hiding the queue controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await boot(page, { tickets: [] });
  await page.goto(`${BASE_URL}/admin.html#support`);
  await expect(page.locator('[data-support-tickets]')).toContainText('No tickets here');
  await expect(page.locator('[data-support-queue="needs_reply"]')).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/admin-desktop-empty.png` });
});

test('captures a 390px stale reply conflict with its exact draft and version preserved', async ({ page }) => {
  let posted = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, { replyConflict: true, onPost: (body) => { posted = body; } });
  await page.goto(`${BASE_URL}/admin.html#support`);
  await page.locator('[data-support-ticket-id]').click();
  await page.locator('#siteSupportReply').fill('Keep this conflict draft');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('.site-support__feedback')).toContainText('draft is kept');
  await expect(page.locator('#siteSupportReply')).toHaveValue('Keep this conflict draft');
  expect(posted).toEqual({
    action: 'reply',
    ticket_id: TICKET_ID,
    version: 4,
    body: 'Keep this conflict draft',
    order_id: ORDER_ID,
  });
  expect(await page.evaluate(() => ({
    width: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))).toEqual({ width: 390, client: 390, scroll: 390 });
  await page.screenshot({ path: `${ARTIFACTS}/admin-mobile-390-conflict.png` });
});
