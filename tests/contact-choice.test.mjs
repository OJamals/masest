import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteHandler } from '../functions/api/quote.js';
import { deliverQuoteIntakeEmail } from '../functions/_lib/quote-intake-effects.js';
import { deliverIntegrationEffect } from '../functions/_lib/integration-effects.js';
import { sendEmailResult } from '../functions/_lib/supabase.js';
import { categoryPolicy } from '../functions/_lib/email-policy.js';
import { quoteContactLabel, quoteContactActions } from '../js/admin/quotes.js';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';

const quoteId = '22222222-2222-4222-8222-222222222222';
const intakeId = '11111111-1111-4111-8111-111111111111';
const request = fields => new Request('https://masest.test/api/quote', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ submission_id: intakeId, ...fields }),
});
const dependencies = {
  rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'verified' }),
  adminClient: () => ({}),
};

test('phone-only leads have a useful CRM title and call action without empty email actions', () => {
  const lead = { type: 'callback', phone: '+1 (813) 555-0123', email: null };
  assert.equal(quoteContactLabel(lead), lead.phone);
  assert.match(quoteContactActions(lead), /href="tel:\+18135550123"/);
  assert.doesNotMatch(quoteContactActions(lead), /mailto:/);
  assert.doesNotMatch(quoteContactActions({ phone: 'javascript:alert(1)' }), /href=/);
});

test('phone-only callback persists a quote, strips stale email fields, and disables nurture', async () => {
  let saved;
  const handler = createQuoteHandler({ ...dependencies, saveIntake: async (_sb, row) => { saved = row; return { quoteId }; } });
  const response = await handler({ env: {}, request: request({
    type: 'callback', phone: ' +1 (813) 555-0123 ', request_topic: 'private-label',
    email: 'stale@example.com', name: 'Stale name', company: 'Stale company',
    private_label_application: 'Stale details', marketing_email_enabled: true,
    product: 'VertKleen HCR',
  }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).durable, true);
  assert.equal(saved.row.phone, '+1 (813) 555-0123');
  assert.equal(saved.row.email, null);
  assert.equal(saved.row.name, null);
  assert.equal(saved.row.company, null);
  assert.equal(saved.row.type, 'callback');
  assert.equal(saved.row.payload.request_topic, 'private-label');
  assert.equal(saved.row.payload.product, 'VertKleen HCR');
  assert.equal(saved.row.payload.contact_preference, 'phone');
  assert.equal(saved.row.payload.marketing_email_enabled, false);
  assert.equal(saved.row.payload.private_label_application, undefined);
  assert.match(saved.row.next_step, /Matthew to call/);
});

test('callback still enforces phone, CAPTCHA, intake identity, and durable acceptance', async () => {
  let writes = 0;
  const make = overrides => createQuoteHandler({ ...dependencies, saveIntake: async () => { writes++; return { error: 'intake_unavailable' }; }, ...overrides });
  for (const phone of ['', '555', 'call 8135550123', '1'.repeat(16), ['8135550123']]) {
    const response = await make()({ env: {}, request: request({ type: 'callback', phone }) });
    assert.equal((await response.json()).error, 'valid_phone_required');
  }
  const fields = { type: 'callback', phone: '+44 20 7946 0123' };
  const rejected = await make({ verifyTurnstile: async () => ({ status: 'rejected' }) })({ env: {}, request: request(fields) });
  assert.equal((await rejected.json()).error, 'captcha_failed');
  const noIdentity = await make()({ env: {}, request: request({ ...fields, submission_id: '' }) });
  assert.equal((await noIdentity.json()).error, 'submission_id_required');
  assert.equal(writes, 0);
  const failed = await make()({ env: {}, request: request(fields) });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).durable, undefined);
});

test('both lead choices use the Cloudflare transactional binding and Matthew as sole recipient', async () => {
  assert.equal(categoryPolicy('lead_internal').provider, 'cloudflare');
  for (const type of ['callback', 'private-label']) {
    const messages = [];
    const env = { SALES_EMAIL: 'someone-else@example.com', EMAIL_SERVICE: {
      fetch: async (url, init) => {
        assert.equal(url, 'https://email.service/v1/send');
        messages.push(JSON.parse(init.body));
        return Response.json({ ok: true, providerMessageId: 'test-provider-id' });
      },
    } };
    const email = type === 'callback' ? null : 'buyer@example.com';
    const result = await deliverQuoteIntakeEmail(env, {}, {
      id: quoteId, type, email, payload: { phone: '+1 (813) 555-0123', request_topic: 'private-label' },
    }, 'internal', {
      salesRecipients: () => ['not-the-recipient@example.com'],
      sendEmail: (bindings, input) => sendEmailResult(bindings, { ...input, suppressionLoader: async () => new Map() }),
    });
    assert.equal(result.ok, true);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].to, ['matthew@masest.co']);
    assert.equal(messages[0].stream, 'transactional');
    assert.ok(messages[0].text);
    assert.match(messages[0].html, /tel:\+18135550123/);
    if (email) assert.equal(messages[0].replyTo, email);
  }
});

test('callback autoreply drains as an intentional skip without sending email', async () => {
  const result = await deliverIntegrationEffect({ env: {}, sb: {}, effect: {
    provider: 'masest', effect_type: 'quote_intake_email',
    payload: { quote_id: quoteId, kind: 'autoreply' },
    source_snapshot: { id: quoteId, type: 'callback', email: null, payload: { phone: '8135550123' } },
  } }, { sendEmail: async () => assert.fail('callback must not attempt an email autoreply') });
  assert.equal(result.skipped, true);
  assert.equal(result.providerResult.skipped, 'callback_no_email_requested');
});

async function withPage(fn) {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await fn(page, server.baseUrl);
  } finally { await browser.close(); await server.close(); }
}

test('contact starts with phone only; email mode shows two fields and preserves edits across choices', async () => {
  await withPage(async (page, base) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/contact?type=private-label`);
      await page.locator('#requestCall').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#quoteForm input:visible:not(#fGotcha)').count(), 1);
      assert.equal(await page.locator('#fEmail').isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#fCallbackPhone').fill('+1 813 555 0123');
      await page.getByRole('button', { name: /Add request details/ }).click();
      assert.equal(await page.locator('#quoteForm input:visible:not(#fGotcha), #quoteForm textarea:visible').count(), 2);
      await page.locator('#fEmail').fill('buyer@example.com');
      await page.locator('#fMessage').fill('Please email me about private labeling.');
      await page.getByRole('button', { name: /Request a call Just/ }).click();
      assert.equal(await page.locator('#fCallbackPhone').inputValue(), '+1 813 555 0123');
      assert.equal(await page.locator('#fEmail').isDisabled(), true);
      await page.getByRole('button', { name: /Add request details/ }).click();
      assert.equal(await page.locator('#fEmail').inputValue(), 'buyer@example.com');
      assert.equal(await page.locator('#fMessage').inputValue(), 'Please email me about private labeling.');
    }
  });
});

test('phone-only submit validates locally, carries product context, and shows durable success', async () => {
  await withPage(async (page, base) => {
    const sent = [];
    await page.route('**/api/quote', async route => {
      sent.push(route.request().postData());
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, durable: true, quote_id: quoteId }) });
    });
    await page.goto(`${base}/contact?type=sample&product=VertKleen%20HCR`);
    await page.getByRole('button', { name: 'Request my call' }).click();
    assert.equal(sent.length, 0);
    assert.equal(await page.locator('#fCallbackPhone').getAttribute('aria-invalid'), 'true');
    await page.locator('#fCallbackPhone').fill('8135550123');
    await page.getByRole('button', { name: 'Request my call' }).click();
    await page.getByRole('heading', { name: 'Call requested.' }).waitFor();
    assert.equal(sent.length, 1);
    assert.match(sent[0], /8135550123/);
    assert.match(sent[0], /VertKleen HCR/);
    assert.doesNotMatch(sent[0], /name="(?:email|name|company|marketing_email_enabled)"/);
    assert.equal(await page.locator('#mailtoFallback').isVisible(), false);
  });
});

test('email path accepts email alone and failed callback preserves number with honest fallback', async () => {
  await withPage(async (page, base) => {
    let status = 201;
    await page.route('**/api/quote', route => route.fulfill({ status, contentType: 'application/json', body: status === 201
      ? JSON.stringify({ ok: true, durable: true, quote_id: quoteId }) : '{"error":"intake_unavailable"}' }));
    await page.goto(`${base}/contact`);
    await page.getByRole('button', { name: /Add request details/ }).click();
    await page.locator('#fEmail').fill('buyer@example.com');
    await page.getByRole('button', { name: 'Send for an email reply' }).click();
    await page.getByRole('heading', { name: 'Request received.' }).waitFor();
    status = 503;
    await page.goto(`${base}/contact`);
    await page.locator('#fCallbackPhone').fill('8135550123');
    await page.getByRole('button', { name: 'Request my call' }).click();
    await page.getByRole('heading', { name: 'Almost there: send the request.' }).waitFor();
    assert.match(decodeURIComponent(await page.locator('#mailtoFallback').getAttribute('href')), /mailto:matthew@masest.co.*Call requested: 8135550123/);
    await page.getByRole('button', { name: 'Edit my request' }).click();
    assert.equal(await page.locator('#fCallbackPhone').inputValue(), '8135550123');
    assert.equal(await page.locator('#fCallbackPhone').evaluate(el => el === document.activeElement), true);
  });
});
