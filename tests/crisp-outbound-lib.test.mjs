import assert from 'node:assert/strict';
import test from 'node:test';
import { crispConfigured, buildOperatorMessage, sendCrispMessage } from '../functions/_lib/crisp.js';

test('crispConfigured requires plugin token + website id', () => {
  assert.equal(crispConfigured({}), false);
  assert.equal(crispConfigured({ CRISP_TOKEN_ID: 'a', CRISP_TOKEN_KEY: 'b' }), false);
  assert.equal(crispConfigured({ CRISP_TOKEN_ID: 'a', CRISP_TOKEN_KEY: 'b', MASEST_CRISP_ID: 'c' }), true);
});

test('buildOperatorMessage shapes an operator text message (capped)', () => {
  assert.deepEqual(buildOperatorMessage('Hello'), { type: 'text', from: 'operator', origin: 'chat', content: 'Hello' });
  assert.equal(buildOperatorMessage('x'.repeat(5000)).content.length, 4000);
});

test('sendCrispMessage no-ops without config or text', async () => {
  assert.deepEqual(await sendCrispMessage({}, { sessionId: 's', text: 'hi' }), { ok: false, skipped: true });
  const env = { CRISP_TOKEN_ID: 'a', CRISP_TOKEN_KEY: 'b', MASEST_CRISP_ID: 'c' };
  assert.deepEqual(await sendCrispMessage(env, { sessionId: 's', text: '  ' }), { ok: false, skipped: true });
});

test('sendCrispMessage POSTs an operator message with plugin auth', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: 202 }; };
  try {
    const r = await sendCrispMessage(env, { sessionId: 'sess-1', text: 'Reply text' });
    assert.equal(r.ok, true);
    assert.match(calls[0].url, /\/v1\/website\/wid\/conversation\/sess-1\/message$/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.from, 'operator');
    assert.equal(body.content, 'Reply text');
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
    assert.equal(calls[0].opts.headers['X-Crisp-Tier'], 'plugin');
  } finally { globalThis.fetch = orig; }
});
