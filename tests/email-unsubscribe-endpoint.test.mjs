import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet, onRequestPost } from '../functions/api/email/unsubscribe.js';
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
  const res = await onRequestPost({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /unsubscribed/i);
});

test('POST rejects a token bound to a different email (no arbitrary suppression)', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const res = await onRequestPost({ request: req('attacker@evil.co', tok, 'POST'), env });
  assert.equal(res.status, 400);
});
