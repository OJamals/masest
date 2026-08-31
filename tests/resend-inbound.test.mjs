import assert from 'node:assert/strict';
import test from 'node:test';

import { routeInboundMessageReply } from '../functions/_lib/support-email.js';

test('inbound retry reconciles duplicate atomic message then retries idempotent staff alert', async () => {
  let upserts = 0;
  let sends = 0;
  const dependencies = {
    sb: {},
    receivedEmail: async () => ({ data: {
      from: 'buyer@example.com',
      to: ['reply+00000000-0000-4000-8000-000000000001@masest.co'],
      text: 'Please update my order.',
    } }),
    companyIdFromReplyAddress: async () => '00000000-0000-4000-8000-000000000001',
    senderIdentity: async () => ({ role: 'buyer', userId: 'user-1' }),
    replyContext: async () => ({ recipientUserId: null, orderId: null }),
    upsertMessage: async () => ({
      id: 'message-1',
      message_id: 'message-1',
      company_id: '00000000-0000-4000-8000-000000000001',
      sender_role: 'buyer',
      user_id: 'user-1',
      body: 'Please update my order.',
      inserted: upserts++ === 0,
      company_name: 'Buyer Co',
    }),
    deliverMessage: async () => {
      sends += 1;
      if (sends === 1) throw new Error('response_lost_after_atomic_insert');
      return { ok: true };
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
    sb: {},
    receivedEmail: async () => ({ data: {
      from: 'buyer@example.com',
      to: ['reply+00000000-0000-4000-8000-000000000001@masest.co'],
      text: 'Please update my order.',
    } }),
    companyIdFromReplyAddress: async () => '00000000-0000-4000-8000-000000000001',
    senderIdentity: async () => ({ role: 'buyer', userId: 'user-1' }),
    replyContext: async () => ({ recipientUserId: null, orderId: null }),
    upsertMessage: async () => ({
      id: 'message-1',
      message_id: 'message-1',
      company_id: '00000000-0000-4000-8000-000000000001',
      sender_role: 'buyer',
      user_id: 'user-1',
      body: 'Please update my order.',
      inserted: upserts++ === 0,
      company_name: 'Buyer Co',
    }),
    deliverMessage: async () => {
      sends += 1;
      return sends > 1 ? { ok: true } : { ok: false, error: 'resend_inbound_delivery_failed' };
    },
  };
  const event = { data: { email_id: 'email-1' } };
  const env = { MESSAGE_REPLY_DOMAIN: 'masest.co' };
  await assert.rejects(routeInboundMessageReply(env, event, dependencies), /resend_inbound_delivery_failed/);
  assert.deepEqual(await routeInboundMessageReply(env, event, dependencies), { routed: true, duplicate: true });
  assert.equal(upserts, 2);
  assert.equal(sends, 2);
});
