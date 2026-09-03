import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUnsubscribePostHandler,
  onRequestGet,
  onRequestPost,
} from '../functions/api/email/unsubscribe.js';
import { unsubscribeToken } from '../functions/_lib/email.js';

const env = { EMAIL_UNSUB_SECRET: 'test-secret' };
const req = (email, token, method = 'GET') =>
  new Request(`https://masest.co/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`, { method });

test('GET rejects an invalid token', async () => {
  const res = await onRequestGet({ request: req('a@b.co', 'bad'), env });
  assert.equal(res.status, 400);
});

test('GET with a valid token shows a POST confirm form (no auto-unsub on prefetch)', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const res = await onRequestGet({ request: req('a@b.co', tok), env });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /method="POST"/);
  assert.match(body, /Unsubscribe/);
});

test('POST one-click with a valid token confirms the unsubscribe', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const handler = createUnsubscribePostHandler({
    setPreference: async () => ({ ok: true, count: 1 }),
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /unsubscribed/i);
});

test('POST does not claim success when local suppression cannot persist', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const handler = createUnsubscribePostHandler({
    setPreference: async () => ({ ok: false, error: 'marketing_preference_write_failed', retryable: true }),
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /could not save/i);
});

test('POST writes one atomic local marketing preference', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  let input;
  const handler = createUnsubscribePostHandler({
    setPreference: async (_env, value) => { input = value; return { ok: true, count: 1 }; },
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 200);
  assert.deepEqual(input, {
    email: 'a@b.co',
    enabled: false,
    source: 'email_unsubscribe',
  });
});

test('unsubscribe endpoint writes canonical local marketing consent only', () => {
  const src = new URL('../functions/api/email/unsubscribe.js', import.meta.url);
  return import('node:fs/promises').then(({ readFile }) => readFile(src, 'utf8')).then((body) => {
    assert.match(body, /setPreference = setMarketingPreference/);
    assert.match(body, /enabled: false/);
    assert.match(body, /source: 'email_unsubscribe'/);
    assert.doesNotMatch(body, /klaviyo/i);
  });
});

test('POST rejects a token bound to a different email (no arbitrary suppression)', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const res = await onRequestPost({ request: req('attacker@evil.co', tok, 'POST'), env });
  assert.equal(res.status, 400);
});
