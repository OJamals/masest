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
    record: async () => true,
    unsubscribe: async () => ({ ok: true, status: 202 }),
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /unsubscribed/i);
});

test('POST does not claim success when local suppression cannot persist', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  let providerCalls = 0;
  const handler = createUnsubscribePostHandler({
    record: async () => false,
    unsubscribe: async () => { providerCalls += 1; return { ok: true }; },
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /could not save/i);
  assert.equal(providerCalls, 0);
});

test('POST reports pending provider sync after durable local suppression', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const handler = createUnsubscribePostHandler({
    record: async () => true,
    unsubscribe: async () => ({ ok: false, status: 503 }),
  });
  const res = await handler({ request: req('a@b.co', tok, 'POST'), env });
  const body = await res.text();
  assert.equal(res.status, 503);
  assert.match(body, /saved locally/i);
  assert.match(body, /retry/i);
});

test('unsubscribe endpoint syncs marketing opt-out to local suppression + Klaviyo', () => {
  const src = new URL('../functions/api/email/unsubscribe.js', import.meta.url);
  return import('node:fs/promises').then(({ readFile }) => readFile(src, 'utf8')).then((body) => {
    assert.match(body, /record = recordSuppression/);
    assert.match(body, /unsubscribe = klaviyoUnsubscribe/);
    assert.match(body, /record\(env, email, 'unsubscribe', 'marketing'\)/);
    assert.match(body, /unsubscribe\(env, email, env\.KLAVIYO_LIST_ID/);
  });
});

test('POST rejects a token bound to a different email (no arbitrary suppression)', async () => {
  const tok = await unsubscribeToken('a@b.co', env.EMAIL_UNSUB_SECRET);
  const res = await onRequestPost({ request: req('attacker@evil.co', tok, 'POST'), env });
  assert.equal(res.status, 400);
});
