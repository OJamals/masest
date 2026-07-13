import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteHandler } from '../functions/api/quote.js';
import { verifyTurnstile } from '../functions/_lib/turnstile.js';

function quoteRequest(body) {
  return new Request('https://masest.test/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.10' },
    body: JSON.stringify({ name: 'Buyer', email: 'buyer@example.com', ...body }),
  });
}

async function result(response) {
  return { status: response.status, body: await response.json() };
}

test('Turnstile helper allows explicit unconfigured mode without fetch', async () => {
  const out = await verifyTurnstile({
    secret: '',
    token: '',
    fetchImpl: async () => { throw new Error('fetch must not run'); },
  });
  assert.deepEqual(out, { status: 'unconfigured' });
});

test('Turnstile helper requires token when secret exists', async () => {
  const out = await verifyTurnstile({
    secret: 'secret',
    token: '',
    fetchImpl: async () => { throw new Error('fetch must not run'); },
  });
  assert.deepEqual(out, { status: 'rejected' });
});

test('Turnstile helper distinguishes rejection from verifier outage', async () => {
  const rejected = await verifyTurnstile({
    secret: 'secret',
    token: 'bad',
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) }),
  });
  const unavailable = await verifyTurnstile({
    secret: 'secret',
    token: 'token',
    fetchImpl: async () => { throw new Error('network down'); },
  });
  const malformed = await verifyTurnstile({
    secret: 'secret',
    token: 'token',
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }),
  });
  assert.deepEqual(rejected, { status: 'rejected' });
  assert.deepEqual(unavailable, { status: 'unavailable' });
  assert.deepEqual(malformed, { status: 'unavailable' });
});

function failIfCalled(label) {
  return () => { throw new Error(`${label} must not run`); };
}

test('configured quote route rejects missing token before side effects', async () => {
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile,
    adminClient: failIfCalled('DB'),
    sendEmail: failIfCalled('email'),
    subscribeLeadByIndustry: failIfCalled('Klaviyo'),
  });
  const out = await result(await handler({ request: quoteRequest({}), env: { TURNSTILE_SECRET: 'secret' } }));
  assert.deepEqual(out, { status: 400, body: { error: 'captcha_failed' } });
});

test('quote verifier outage returns 503 before side effects', async () => {
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: 'unavailable' }),
    adminClient: failIfCalled('DB'),
    sendEmail: failIfCalled('email'),
    subscribeLeadByIndustry: failIfCalled('Klaviyo'),
  });
  const out = await result(await handler({
    request: quoteRequest({ 'cf-turnstile-response': 'token' }),
    env: { TURNSTILE_SECRET: 'secret' },
  }));
  assert.deepEqual(out, { status: 503, body: { error: 'captcha_unavailable' } });
});
