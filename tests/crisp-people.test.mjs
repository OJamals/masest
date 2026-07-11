import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { listCrispMessages, sendCrispMessage } from '../functions/_lib/crisp.js';

test('outbound messaging no-ops without free-tier website token configuration', async () => {
  assert.deepEqual(await sendCrispMessage({}, { sessionId: 's', text: 'hello' }), { ok: false, skipped: true });
  const env = { CRISP_TOKEN_ID: 'a', CRISP_TOKEN_KEY: 'b', MASEST_CRISP_ID: 'c' };
  assert.deepEqual(await sendCrispMessage(env, {}), { ok: false, skipped: true });
});

test('outbound messaging uses a workspace website token', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: 201 }; };
  try {
    const r = await sendCrispMessage(env, { sessionId: 'session 1', text: 'Hello buyer' });
    assert.deepEqual(r, { ok: true, status: 201 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].url, /\/v1\/website\/wid\/conversation\/session%201\/message$/);
    assert.equal(JSON.parse(calls[0].opts.body).content, 'Hello buyer');
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
    assert.equal(calls[0].opts.headers['X-Crisp-Tier'], 'website');
  } finally { globalThis.fetch = orig; }
});

test('message listing uses the workspace website token', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ data: [{ content: 'Hello' }] }) }; };
  try {
    assert.deepEqual(await listCrispMessages(env, 'session 1'), [{ content: 'Hello' }]);
    assert.equal(calls[0].opts.headers['X-Crisp-Tier'], 'website');
  } finally { globalThis.fetch = orig; }
});

const contacts = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');
test('free-tier CRM contact writes do not call paid Crisp People APIs', () => {
  assert.doesNotMatch(contacts, /crisp\.js|upsertCrispPerson|people\/profile/);
});
