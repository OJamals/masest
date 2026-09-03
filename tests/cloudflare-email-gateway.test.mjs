import assert from 'node:assert/strict';
import test from 'node:test';

import { emailConfigured, sendEmailResult } from '../functions/_lib/supabase.js';

function service(handler) {
  return { fetch: handler };
}

test('Pages sends transactional email only through the private Cloudflare service binding', async () => {
  let request = null;
  const env = {
    EMAIL_SERVICE: service(async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        ok: true,
        providerMessageId: '0101018f7d0c4d9a-msg-deadbeef',
        status: 200,
        retryable: false,
        replayed: false,
      });
    }),
  };
  const result = await sendEmailResult(env, {
    to: ['buyer@example.com'],
    subject: 'Order confirmed',
    html: '<p>Confirmed</p>',
    category: 'order',
    replyTo: 'reply@example.com',
    emailHeaders: {
      References: '<root@example.com>',
      'Thread-Topic': 'MASEST support · Buyer Co',
    },
    idempotencyKey: 'order/123/confirmation',
    suppressionLoader: async () => new Map(),
  });
  assert.equal(emailConfigured(env), true);
  assert.equal(request.url, 'https://email.service/v1/send');
  assert.equal(request.body.stream, 'transactional');
  assert.match(request.body.idempotencyKey, /^v1\/[a-f0-9]{64}$/);
  assert.deepEqual(request.body.to, ['buyer@example.com']);
  assert.equal(request.body.replyTo, 'reply@example.com');
  assert.deepEqual(request.body.headers, {
    References: '<root@example.com>',
  });
  assert.deepEqual(result, {
    ok: true,
    providerMessageId: '0101018f7d0c4d9a-msg-deadbeef',
    status: 200,
    retryable: false,
    replayed: false,
    error: null,
  });
});

test('Cloudflare transactional gateway fails closed when unbound and never receives marketing streams', async () => {
  const unconfigured = await sendEmailResult({}, {
    to: ['buyer@example.com'],
    subject: 'Order confirmed',
    html: '<p>Confirmed</p>',
    category: 'order',
    suppressionLoader: async () => new Map(),
  });
  assert.deepEqual(unconfigured, { ok: false, retryable: false, error: 'email_not_configured' });

  let cloudflareCalls = 0;
  let marketingCall = null;
  const marketing = await sendEmailResult({
    EMAIL_SERVICE: service(async () => { cloudflareCalls += 1; return Response.json({ ok: true }); }),
  }, {
    to: ['buyer@example.com'],
    subject: 'Offer',
    html: '<p>Sale</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
    category: 'offer',
    idempotencyKey: 'offer/1/buyer@example.com',
    suppressionLoader: async () => new Map(),
    marketingSender: async (_env, options) => {
      marketingCall = options;
      return { ok: true, provider: 'ses', providerMessageId: 'ses-1', status: 200, retryable: false };
    },
  });
  assert.equal(cloudflareCalls, 0);
  assert.equal(marketing.provider, 'ses');
  assert.equal(marketingCall.to, 'buyer@example.com');
});

test('marketing fails closed when suppression state cannot be read', async () => {
  let sends = 0;
  const result = await sendEmailResult({}, {
    to: ['buyer@example.com'],
    subject: 'Offer',
    html: '<a href="{{unsubscribe_url}}">Unsubscribe</a>',
    category: 'offer',
    idempotencyKey: 'offer/2/buyer@example.com',
    suppressionLoader: async () => { throw new Error('database unavailable'); },
    marketingSender: async () => { sends += 1; return { ok: true }; },
  });
  assert.equal(sends, 0);
  assert.deepEqual(result, { ok: false, retryable: true, error: 'suppression_check_failed' });
});

test('Cloudflare transactional gateway rejects missing or unknown categories', async () => {
  let calls = 0;
  const env = {
    EMAIL_SERVICE: service(async () => {
      calls += 1;
      return Response.json({ ok: true, providerMessageId: 'should-not-send' });
    }),
  };
  const base = {
    to: ['buyer@example.com'],
    subject: 'Unclassified message',
    html: '<p>Unclassified</p>',
    suppressionLoader: async () => new Map(),
  };
  const missing = await sendEmailResult(env, base);
  const unknown = await sendEmailResult(env, { ...base, category: 'future_campaign' });

  assert.equal(missing.error, 'email_category_required');
  assert.equal(unknown.error, 'email_category_required');
  assert.equal(missing.retryable, false);
  assert.equal(unknown.retryable, false);
  assert.equal(calls, 0);
});

test('private gateway preserves retry classification and stable idempotency', async () => {
  const keys = [];
  const env = {
    EMAIL_SERVICE: service(async (_url, init) => {
      keys.push(JSON.parse(init.body).idempotencyKey);
      return Response.json({ ok: false, status: 429, retryable: true, error: 'email_rate_limited' }, { status: 429 });
    }),
  };
  const options = {
    to: ['buyer@example.com'],
    subject: 'Receipt',
    html: '<p>Receipt</p>',
    category: 'order',
    idempotencyKey: 'same-logical-message',
    suppressionLoader: async () => new Map(),
  };
  const first = await sendEmailResult(env, options);
  const second = await sendEmailResult(env, options);
  assert.equal(first.status, 429);
  assert.equal(first.retryable, true);
  assert.equal(first.error, 'email_rate_limited');
  assert.equal(keys[0], keys[1]);
});

test('private gateway caps combined visible and blind recipients at provider limit', async () => {
  let payload = null;
  const env = {
    EMAIL_SERVICE: service(async (_url, init) => {
      payload = JSON.parse(init.body);
      return Response.json({
        ok: true,
        providerMessageId: '0101018f7d0c4d9a-msg-recipient-cap',
        status: 200,
      });
    }),
  };
  await sendEmailResult(env, {
    to: Array.from({ length: 40 }, (_, index) => `to-${index}@example.com`),
    bcc: Array.from({ length: 40 }, (_, index) => `bcc-${index}@example.com`),
    subject: 'Bounded recipients',
    html: '<p>Bounded</p>',
    category: 'order',
    suppressionLoader: async () => new Map(),
  });

  assert.equal(payload.to.length, 40);
  assert.equal(payload.bcc.length, 10);
});
