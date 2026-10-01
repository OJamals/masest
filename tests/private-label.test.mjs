import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteHandler } from '../functions/api/quote.js';
import { QUOTE_LABELS } from '../functions/_lib/quote-intake-effects.js';
import { requestDetailsHtml } from '../js/admin/quotes.js';
import { PRIVATE_LABEL_DETAILS } from '../js/quote-task-details.js';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';

const quoteId = '22222222-2222-4222-8222-222222222222';
const payload = {
  submission_id: '11111111-1111-4111-8111-111111111111',
  type: 'private-label', name: 'Test buyer', email: 'buyer@example.com', company: 'Test company',
  private_label_application: 'Cleaning stainless equipment', private_label_quantity: 'Not sure yet',
  private_label_packaging: 'Discuss options', private_label_destination: 'Tampa, Florida, USA',
};

test('private-label inquiry persists bounded details, destination, and a useful sales next step', async () => {
  let saved;
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}), saveIntake: async (_sb, row) => { saved = row; return { quoteId }; },
  });
  const request = new Request('https://masest.test/api/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, private_label_packaging: 'x'.repeat(300) }),
  });
  const response = await handler({ request, env: {} });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).durable, true);
  assert.equal(saved.row.type, 'private-label');
  assert.equal(saved.row.location, payload.private_label_destination);
  assert.equal(saved.row.payload.private_label_packaging.length, 160);
  assert.match(saved.row.next_step, /branding, quantity, packaging, delivery/);
  for (const { name, label } of PRIVATE_LABEL_DETAILS) {
    assert.equal(QUOTE_LABELS[name], label, 'sales email preserves readable field names');
    assert.ok(requestDetailsHtml(saved.row).includes(label), 'CRM renders each inquiry detail');
  }
});

test('private-label email intake can start with only an email address', async () => {
  let saved;
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}), saveIntake: async (_sb, row) => { saved = row; return { quoteId }; },
  });
  const response = await handler({ env: {}, request: new Request('https://masest.test/api/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ submission_id: payload.submission_id, type: 'private-label', email: payload.email }),
  }) });
  assert.equal(response.status, 201);
  assert.equal(saved.row.name, null);
  assert.equal(saved.row.company, null);
  assert.equal(saved.row.payload.contact_preference, 'email');
});

async function withPage(fn) {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
    await fn(page, server.baseUrl);
  } finally { await browser.close(); await server.close(); }
}

test('private-label journey selects visible fields and preserves details across intent changes', async () => {
  await withPage(async (page, base) => {
    await page.goto(base);
    const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await primary.getByText('Products', { exact: true }).click();
    await primary.getByRole('link', { name: 'Private Label', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/private-label');
    await page.locator('.home-hero').getByRole('link', { name: 'Request a private-label quote' }).click();
    await page.getByRole('button', { name: /Add request details/ }).click();
    await page.locator('#requestExtraDetails > summary').click();
    await page.locator('[data-intent-group="private-label"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#fType').inputValue(), 'private-label');
    assert.equal(await page.locator('#fCompany').getAttribute('required'), null);
    await page.locator('#fPrivateApplication').fill('Stainless maintenance');
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    assert.equal(await page.locator('#fPrivateApplication').isDisabled(), true);
    assert.equal(await page.locator('#fMessage').getAttribute('aria-required'), 'false');
    await page.getByRole('button', { name: 'Private Label', exact: true }).click();
    assert.equal(await page.locator('#fPrivateApplication').inputValue(), 'Stainless maintenance');
    assert.equal(await page.locator('#fPrivateApplication').isDisabled(), false);
    assert.equal(await page.locator('#fMessage').getAttribute('aria-required'), 'false');
  });
});

test('private-label form validates then acknowledges a durable local test submission', async () => {
  await withPage(async (page, base) => {
    const sent = [];
    await page.route('**/api/quote', async route => {
      sent.push(route.request().postData());
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, durable: true, quote_id: quoteId }) });
    });
    await page.goto(`${base}/contact?type=private-label`);
    await page.getByRole('button', { name: /Add request details/ }).click();
    await page.getByRole('button', { name: 'Send for an email reply' }).click();
    assert.equal(sent.length, 0);
    assert.equal(await page.locator('#fEmail').getAttribute('aria-invalid'), 'true');
    await page.locator('#requestExtraDetails > summary').click();
    await page.locator('#fName').fill(payload.name);
    await page.locator('#fEmail').fill(payload.email);
    await page.locator('#fCompany').fill(payload.company);
    for (const { id, name } of PRIVATE_LABEL_DETAILS) await page.locator(`#${id}`).fill(payload[name]);
    await page.locator('#fMarketingEmail').uncheck();
    await page.getByRole('button', { name: 'Send for an email reply' }).click();
    await page.getByRole('heading', { name: 'Request received.', exact: true }).waitFor();
    assert.equal(sent.length, 1);
    for (const { name } of PRIVATE_LABEL_DETAILS) assert.ok(sent[0].includes(payload[name]));
    assert.ok(sent[0].includes('private-label'));
    assert.ok(!sent[0].includes('name="marketing_email_enabled"'));
    assert.equal(await page.locator('#mailtoFallback').isVisible(), false);
  });
});

test('failed private-label submission keeps an honest fallback and editable details', async () => {
  await withPage(async (page, base) => {
    await page.route('**/api/quote', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"intake_unavailable"}' }));
    await page.goto(`${base}/contact?type=private-label`);
    await page.getByRole('button', { name: /Add request details/ }).click();
    await page.locator('#requestExtraDetails > summary').click();
    await page.locator('#fName').fill(payload.name);
    await page.locator('#fEmail').fill(payload.email);
    await page.locator('#fCompany').fill(payload.company);
    await page.locator('#fPrivateApplication').fill(payload.private_label_application);
    await page.getByRole('button', { name: 'Send for an email reply' }).click();
    await page.getByRole('heading', { name: 'Almost there: send the request.' }).waitFor();
    assert.equal(await page.locator('#mailtoFallback').isVisible(), true);
    assert.ok(decodeURIComponent(await page.locator('#mailtoFallback').getAttribute('href')).includes('Private-label application: Cleaning stainless equipment'));
    await page.getByRole('button', { name: 'Edit my request' }).click();
    assert.equal(await page.locator('#fPrivateApplication').inputValue(), payload.private_label_application);
    assert.equal(await page.getByRole('button', { name: 'Send for an email reply' }).isEnabled(), true);
  });
});
