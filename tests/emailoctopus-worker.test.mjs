import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createEmailOctopusWebhook, runEmailOctopusSync } from '../workers/marketing-email/src/emailoctopus.js';
import { runMarketingProviders } from '../workers/marketing-email/src/index.js';
import { onRequestGet as emailOctopusStatus } from '../functions/api/admin/emailoctopus.js';

const list = '00000000-0000-4000-8000-000000000001';
const env = { EMAILOCTOPUS_ENABLED: 'true', EMAILOCTOPUS_LIST_ID: list, EMAILOCTOPUS_WEBHOOK_SECRET: 'signing-secret' };
const event = { id: '00000000-0000-4000-8000-000000000002', list_id: list, type: 'contact.unsubscribed', contact_email_address: 'Reader@example.com' };
function signed(events, secret = env.EMAILOCTOPUS_WEBHOOK_SECRET) {
  const body = JSON.stringify(events);
  return new Request('https://worker.test/v1/emailoctopus/events', { method: 'POST', body,
    headers: { 'EmailOctopus-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } });
}

test('signed webhook applies only negative events for the configured list', async () => {
  const calls = [];
  const handler = createEmailOctopusWebhook({ createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: true }; } }) });
  const response = await handler(signed([event, { ...event, type: 'contact.created', contact_status: 'SUBSCRIBED' }, { ...event, list_id: event.id }]), env);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'apply_emailoctopus_event');
  assert.equal(calls[0].args.p_recipient, 'reader@example.com');
  assert.equal(calls[0].args.p_kind, 'unsubscribed');
});

test('invalid signature, malformed batch, and excessive input cannot mutate consent', async () => {
  const handler = createEmailOctopusWebhook({ createClient: () => { throw new Error('must not reach persistence'); } });
  assert.equal((await handler(signed([event], 'wrong'), env)).status, 401);
  assert.equal((await handler(signed([event, { ...event, id: 'invalid' }]), env)).status, 400);
  assert.equal((await handler(signed(Array(1001).fill(event)), env)).status, 400);
  const huge = signed([{ ...event, filler: 'x'.repeat(1024 * 1024) }]);
  assert.equal((await handler(huge, env)).status, 413);
});

test('persistence failure is retryable by the webhook provider and never leaks error contents', async () => {
  const handler = createEmailOctopusWebhook({ createClient: () => ({ rpc: async () => ({ error: 'secret reader@example.com' }) }) });
  const response = await handler(signed([event]), env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret|reader@/);
});

test('sync stays disabled without activation and requires working list verification before claiming contacts', async () => {
  assert.deepEqual(await runEmailOctopusSync({}), { ok: true, disabled: true });
  await assert.rejects(runEmailOctopusSync({ EMAILOCTOPUS_ENABLED: 'true' }), /webhook_not_configured/);
  await assert.rejects(runEmailOctopusSync(env, {
    checkList: async () => ({ ok: false, error: 'emailoctopus_http_401' }),
    createClient: () => { throw new Error('must not access database'); },
  }), /emailoctopus_http_401/);
});

test('provider failure is persisted and stops draining the audience', async () => {
  const calls = [];
  const sb = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'claim_emailoctopus_contact') return { data: [{ recipient: 'reader@example.com', revision: 4, enabled: true, erase: false }] };
    return { data: true };
  } };
  const result = await runEmailOctopusSync(env, {
    createClient: () => sb, checkList: async () => ({ ok: true }),
    syncContact: async () => ({ ok: false, retryable: true, error: 'emailoctopus_http_429' }),
  });
  assert.deepEqual(result, { ok: false, synced: 0, failed: 1 });
  assert.equal(calls.filter(c => c.name === 'claim_emailoctopus_contact').length, 1);
  const finished = calls.find(c => c.name === 'finish_emailoctopus_contact').args;
  assert.equal(finished.p_revision, 4);
  assert.equal(finished.p_retryable, true);
});

test('EmailOctopus runs even when SES fails; SES runs when companion fails', async () => {
  for (const failure of ['ses', 'companion']) {
    const calls = [];
    await assert.rejects(runMarketingProviders({}, {}, {
      runSes: async () => { calls.push('ses'); if (failure === 'ses') throw new Error('ses_down'); },
      runCompanion: async () => { calls.push('companion'); if (failure === 'companion') throw new Error('companion_down'); },
    }), /_down/);
    assert.deepEqual(calls.sort(), ['companion', 'ses']);
  }
});

test('status endpoint is staff-only and exposes only aggregate operational state', async () => {
  const context = { request: new Request('https://masest.co/api/admin/emailoctopus'), env: {} };
  assert.equal((await emailOctopusStatus(context, { authorize: async () => ({}) })).status, 401);
  assert.equal((await emailOctopusStatus(context, { authorize: async () => ({ user: {} }) })).status, 403);
  const response = await emailOctopusStatus(context, { authorize: async () => ({ user: {}, staff: true }),
    createClient: () => ({ rpc: async () => ({ data: { pending: 3, synced: 4, api_key: 'secret', recipient: 'reader@example.com', list_id: list } }) }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pending, 3);
  assert.doesNotMatch(JSON.stringify(body), /secret|reader@|list_id/);
});
