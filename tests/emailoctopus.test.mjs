import assert from 'node:assert/strict';
import test from 'node:test';
import { syncEmailOctopusContact } from '../functions/_lib/emailoctopus.js';

const env = { EMAILOCTOPUS_API_KEY: 'test-secret', EMAILOCTOPUS_LIST_ID: '00000000-0000-4000-8000-000000000001' };
const contact = { recipient: 'reader@example.com', enabled: true, erase: false };
const remote = { id: 'contact-1', email_address: contact.recipient, status: 'subscribed' };

function transport(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    assert.ok(next, 'unexpected provider request');
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  } };
}

test('EmailOctopus creates only missing, explicitly eligible contacts through API v2', async () => {
  const http = transport([{ status: 404 }, { status: 201, body: remote }]);
  const result = await syncEmailOctopusContact(env, contact, http);
  assert.equal(result.ok, true);
  assert.deepEqual(http.calls.map(c => c.method), ['GET', 'POST']);
  assert.equal(new URL(http.calls[0].url).origin, 'https://api.emailoctopus.com');
  assert.equal(http.calls[1].headers.authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(http.calls[1].body), { email_address: contact.recipient, status: 'subscribed' });
  assert.equal(http.calls[1].redirect, 'manual');
  assert.ok(http.calls[1].signal instanceof AbortSignal);
  assert.ok(http.calls.every(c => !c.url.includes('test-secret')));
});

test('existing provider opt-outs and pending confirmations are never resubscribed', async () => {
  for (const status of ['unsubscribed', 'bounced', 'complained', 'pending']) {
    const http = transport([{ status: 200, body: { ...remote, status } }]);
    const result = await syncEmailOctopusContact(env, contact, http);
    assert.equal(result.ok, true);
    assert.equal(result.blockedReason || null, status === 'pending' ? null : status);
    assert.equal(http.calls.length, 1);
  }
});

test('a create conflict is reconciled without promoting a concurrently unsubscribed contact', async () => {
  const http = transport([{ status: 404 }, { status: 409 }, { status: 200, body: { ...remote, status: 'unsubscribed' } }]);
  const result = await syncEmailOctopusContact(env, contact, http);
  assert.equal(result.blockedReason, 'unsubscribed');
  assert.deepEqual(http.calls.map(c => c.method), ['GET', 'POST', 'GET']);
});

test('withdrawals never create contacts and erasure deletes a known remote contact', async () => {
  const missing = transport([{ status: 404 }]);
  assert.equal((await syncEmailOctopusContact(env, { ...contact, enabled: false }, missing)).ok, true);
  assert.equal(missing.calls.length, 1);
  const existing = transport([{ status: 200, body: remote }, { status: 200, body: { ...remote, status: 'unsubscribed' } }]);
  assert.equal((await syncEmailOctopusContact(env, { ...contact, enabled: false }, existing)).ok, true);
  assert.deepEqual(JSON.parse(existing.calls[1].body), { status: 'unsubscribed' });
  const erase = transport([{ status: 200, body: remote }, { status: 204 }]);
  assert.equal((await syncEmailOctopusContact(env, { ...contact, erase: true }, erase)).ok, true);
  assert.equal(erase.calls[1].method, 'DELETE');
});

test('provider errors are redacted, bounded, and retryable only when appropriate', async () => {
  for (const [status, retryable] of [[401, false], [429, true], [503, true], [302, false]]) {
    const http = transport([{ status, body: { detail: 'test-secret reader@example.com' } }]);
    const result = await syncEmailOctopusContact(env, contact, http);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, retryable);
    assert.doesNotMatch(JSON.stringify(result), /test-secret|reader@example/);
  }
  const network = transport([new Error('test-secret')]);
  assert.equal((await syncEmailOctopusContact(env, contact, network)).retryable, true);
  const malformed = transport([{ status: 200, body: { ok: true } }]);
  assert.equal((await syncEmailOctopusContact(env, contact, malformed)).ok, false);
  const empty = transport([{ status: 204 }]);
  assert.equal((await syncEmailOctopusContact(env, contact, empty)).error, 'emailoctopus_invalid_response');
});

test('write responses must preserve provider opt-outs and confirm a withdrawal', async () => {
  const created = transport([{ status: 404 }, { status: 201, body: { ...remote, status: 'unsubscribed' } }]);
  assert.equal((await syncEmailOctopusContact(env, contact, created)).blockedReason, 'unsubscribed');
  const ignored = transport([{ status: 200, body: remote }, { status: 200, body: remote }]);
  const result = await syncEmailOctopusContact(env, { ...contact, enabled: false }, ignored);
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
});
