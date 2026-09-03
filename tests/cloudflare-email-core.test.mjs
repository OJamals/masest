import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEmailSendError,
  emailSendErrorDetail,
  normalizeInboundEmail,
  normalizeSendRequest,
  readBoundedJsonRequest,
  shouldIgnoreInboundEmail,
} from '../workers/email-service/src/core.js';

const sendRequest = {
  stream: 'transactional',
  idempotencyKey: 'support-message/11111111-1111-4111-8111-111111111111/staff',
  to: ['buyer@example.com'],
  bcc: [],
  subject: 'MASEST support',
  html: '<p>Hello</p>',
  text: 'Hello',
  replyTo: 'reply+11111111-1111-4111-8111-111111111111.0123456789abcdef0123@reply.masest.co',
  headers: {
    'In-Reply-To': '<parent@example.com>',
    References: '<root@example.com> <parent@example.com>',
  },
  attachments: [],
};

test('email Worker accepts one bounded transactional message and fixes sender identity', () => {
  const normalized = normalizeSendRequest(sendRequest, {
    fromAddress: 'noreply@send.masest.co',
    fromName: 'MASEST',
  });
  assert.equal(normalized.idempotencyKey, sendRequest.idempotencyKey);
  assert.deepEqual(normalized.message.from, { email: 'noreply@send.masest.co', name: 'MASEST' });
  assert.deepEqual(normalized.message.to, ['buyer@example.com']);
  assert.equal(normalized.message.replyTo, sendRequest.replyTo);
  assert.deepEqual(normalized.message.headers, sendRequest.headers);
});

test('email Worker rejects marketing, provider-controlled headers, arbitrary headers, missing keys, and oversized recipient sets', () => {
  const config = { fromAddress: 'noreply@send.masest.co', fromName: 'MASEST' };
  assert.throws(() => normalizeSendRequest({ ...sendRequest, stream: 'marketing' }, config), /marketing_provider_required/);
  assert.throws(() => normalizeSendRequest({ ...sendRequest, idempotencyKey: '' }, config), /idempotency_key_required/);
  assert.throws(() => normalizeSendRequest({ ...sendRequest, headers: { 'Message-ID': '<caller@send.masest.co>' } }, config), /header_not_allowed/);
  assert.throws(() => normalizeSendRequest({ ...sendRequest, headers: { Date: 'tomorrow' } }, config), /header_not_allowed/);
  assert.throws(() => normalizeSendRequest({ ...sendRequest, headers: { 'Thread-Topic': 'Unsupported by live binding' } }, config), /header_not_allowed/);
  assert.throws(() => normalizeSendRequest({
    ...sendRequest,
    to: [`${'a'.repeat(65)}@example.com`],
  }, config), /invalid_recipient/);
  assert.throws(() => normalizeSendRequest({
    ...sendRequest,
    to: Array.from({ length: 51 }, (_, index) => `buyer${index}@example.com`),
  }, config), /too_many_recipients/);
});

test('email Worker bounds streamed request bodies before buffering them', async () => {
  const small = new Request('https://email.service/v1/send', {
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readBoundedJsonRequest(small, 64), { ok: true });

  const oversized = new Request('https://email.service/v1/send', {
    method: 'POST',
    body: JSON.stringify({ body: 'x'.repeat(64) }),
  });
  await assert.rejects(() => readBoundedJsonRequest(oversized, 32), /request_too_large/);

  const malformed = new Request('https://email.service/v1/send', {
    method: 'POST',
    body: '{',
  });
  await assert.rejects(() => readBoundedJsonRequest(malformed, 32), /bad_request/);
});

test('email Worker exposes only explicit transient provider failures as retryable', () => {
  assert.deepEqual(classifyEmailSendError({ code: 'E_RATE_LIMIT_EXCEEDED' }), {
    status: 429,
    retryable: true,
    error: 'email_rate_limited',
  });
  assert.deepEqual(classifyEmailSendError({ code: 'E_INTERNAL_SERVER_ERROR' }), {
    status: 503,
    retryable: true,
    error: 'email_provider_unavailable',
  });
  assert.deepEqual(classifyEmailSendError({ code: 'E_SENDER_NOT_VERIFIED' }), {
    status: 400,
    retryable: false,
    error: 'email_sender_not_verified',
  });
  assert.deepEqual(classifyEmailSendError(new Error('unknown')), {
    status: 502,
    retryable: false,
    error: 'email_delivery_state_unknown',
  });
});

test('email Worker logs bounded provider detail without recipient PII', () => {
  assert.equal(
    emailSendErrorDetail(new Error('Reply-To buyer@example.com must use an available domain')),
    'Reply-To [email] must use an available domain',
  );
  assert.equal(emailSendErrorDetail({ cause: { message: ' '.repeat(2) + 'invalid payload' } }), 'invalid payload');
  assert.equal(emailSendErrorDetail(new Error('x'.repeat(400))).length, 300);
});

test('inbound normalization is privacy-bounded and keeps RFC threading metadata', () => {
  const normalized = normalizeInboundEmail({
    envelopeFrom: 'buyer@example.com',
    envelopeTo: 'reply+11111111-1111-4111-8111-111111111111.0123456789abcdef0123@reply.masest.co',
    parsed: { subject: 'Re: MASEST support', text: 'Status?\n', html: '<p>Status?</p>' },
    headers: new Headers({
      'message-id': '<reply-1@example.com>',
      'in-reply-to': '<parent@example.com>',
      references: '<root@example.com> <parent@example.com>',
    }),
    rawDigest: 'a'.repeat(64),
  });
  assert.equal(normalized.id, '<reply-1@example.com>');
  assert.equal(normalized.from, 'buyer@example.com');
  assert.deepEqual(normalized.to, ['reply+11111111-1111-4111-8111-111111111111.0123456789abcdef0123@reply.masest.co']);
  assert.equal(normalized.text, 'Status?\n');
  assert.deepEqual(normalized.headers, {
    'message-id': '<reply-1@example.com>',
    'in-reply-to': '<parent@example.com>',
    references: '<root@example.com> <parent@example.com>',
  });
});

test('automated and loop-generated inbound email is ignored', () => {
  assert.equal(shouldIgnoreInboundEmail(new Headers({ 'auto-submitted': 'auto-replied' }), 'buyer@example.com'), true);
  assert.equal(shouldIgnoreInboundEmail(new Headers({ precedence: 'bulk' }), 'buyer@example.com'), true);
  assert.equal(shouldIgnoreInboundEmail(new Headers(), 'mailer-daemon@example.com'), true);
  assert.equal(shouldIgnoreInboundEmail(new Headers(), 'buyer@example.com'), false);
});
