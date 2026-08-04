import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchReceivedEmail,
  routeInboundMessageReply,
} from '../functions/_lib/resend-inbound.js';

test('Resend receiving fetch retries transient 429/5xx/config failures and accepts later success', async () => {
  await assert.rejects(fetchReceivedEmail({}, 'email-1'), /resend_receiving_not_configured/);
  for (const status of [429, 500]) {
    await assert.rejects(
      fetchReceivedEmail(
        { RESEND_API_KEY: 'key' },
        'email-1',
        async () => new Response('{}', { status }),
      ),
      new RegExp(`resend_receiving_http_${status}`),
    );
  }
  assert.equal(await fetchReceivedEmail(
    { RESEND_API_KEY: 'key' },
    'email-1',
    async () => Response.json({ data: { text: 'hello' } }),
  ).then((result) => result.data.text), 'hello');
  assert.equal(await fetchReceivedEmail(
    { RESEND_API_KEY: 'key' },
    'missing',
    async () => new Response('', { status: 404 }),
  ), null);
});

function fakeSupabase() {
  return {
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq: async () => ({ data: [{ id: 'user-1' }], error: null }),
      };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'buyer@example.com' } } }) } },
  };
}

test('inbound retry reconciles duplicate atomic message then retries idempotent staff alert', async () => {
  let upserts = 0;
  let sends = 0;
  const dependencies = {
    sb: fakeSupabase(),
    receivedEmail: async () => ({ data: {
      from: 'buyer@example.com',
      to: ['reply+00000000-0000-4000-8000-000000000001@masest.co'],
      text: 'Please update my order.',
    } }),
    companyIdFromReplyAddress: async () => '00000000-0000-4000-8000-000000000001',
    upsertMessage: async () => ({
      message_id: 'message-1',
      inserted: upserts++ === 0,
      alert_kind: 'support_request',
      company_name: 'Buyer Co',
    }),
    adminMessageRecipients: async () => ['staff@masest.co'],
    sendEmail: async () => {
      sends += 1;
      if (sends === 1) throw new Error('response_lost_after_atomic_insert');
      return true;
    },
  };
  const event = { data: { email_id: 'email-1' } };
  const env = { MESSAGE_REPLY_DOMAIN: 'masest.co' };
  await assert.rejects(routeInboundMessageReply(env, event, dependencies), /response_lost/);
  const retry = await routeInboundMessageReply(env, event, dependencies);
  assert.deepEqual(retry, { routed: true, duplicate: true });
  assert.equal(upserts, 2);
  assert.equal(sends, 2);
});

test('inbound alert boolean failure keeps effect retryable after atomic message upsert', async () => {
  let upserts = 0;
  let sends = 0;
  const dependencies = {
    sb: fakeSupabase(),
    receivedEmail: async () => ({ data: {
      from: 'buyer@example.com',
      to: ['reply+00000000-0000-4000-8000-000000000001@masest.co'],
      text: 'Please update my order.',
    } }),
    companyIdFromReplyAddress: async () => '00000000-0000-4000-8000-000000000001',
    upsertMessage: async () => ({
      message_id: 'message-1',
      inserted: upserts++ === 0,
      alert_kind: 'support_request',
      company_name: 'Buyer Co',
    }),
    adminMessageRecipients: async () => ['staff@masest.co'],
    sendEmail: async () => {
      sends += 1;
      return sends > 1;
    },
  };
  const event = { data: { email_id: 'email-1' } };
  const env = { MESSAGE_REPLY_DOMAIN: 'masest.co' };
  await assert.rejects(routeInboundMessageReply(env, event, dependencies), /resend_inbound_alert_failed/);
  assert.deepEqual(await routeInboundMessageReply(env, event, dependencies), { routed: true, duplicate: true });
  assert.equal(upserts, 2);
  assert.equal(sends, 2);
});
