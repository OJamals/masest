import assert from 'node:assert/strict';
import test from 'node:test';

import { routeInboundMessageReply } from '../functions/_lib/support-email.js';

const parent = {
  id: '00000000-0000-4000-8000-000000000009',
  company_id: '00000000-0000-4000-8000-000000000001',
  sender_role: 'staff',
  recipient_user_id: 'user-1',
  user_id: 'staff-1',
  order_id: 'order-1',
};
const input = {
  id: 'email-1',
  from: 'buyer@example.com',
  to: ['reply+00000000-0000-4000-8000-000000000009.token@reply.masest.co'],
  text: 'Please update my order.',
};

function retryDependencies(deliverMessage) {
  let upserts = 0;
  return {
    counters: { get upserts() { return upserts; } },
    dependencies: {
      sb: {},
      messageIdFromReplyAddress: async () => parent.id,
      replyMessage: async () => parent,
      senderIdentity: async () => ({ role: 'buyer', userId: 'user-1' }),
      upsertMessage: async () => ({
        id: 'message-1',
        message_id: 'message-1',
        company_id: parent.company_id,
        sender_role: 'buyer',
        user_id: 'user-1',
        recipient_user_id: null,
        order_id: parent.order_id,
        body: input.text,
        inserted: upserts++ === 0,
        company_name: 'Buyer Co',
      }),
      deliverMessage,
    },
  };
}

test('inbound retry reconciles duplicate atomic chat append then retries email alert', async () => {
  let sends = 0;
  const fixture = retryDependencies(async () => {
    sends += 1;
    if (sends === 1) throw new Error('response_lost_after_atomic_insert');
    return { ok: true };
  });
  await assert.rejects(routeInboundMessageReply({}, input, fixture.dependencies), /response_lost/);
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), { routed: true, duplicate: true });
  assert.equal(fixture.counters.upserts, 2);
  assert.equal(sends, 2);
});

test('inbound email delivery failure remains retryable after atomic chat append', async () => {
  let sends = 0;
  const fixture = retryDependencies(async () => {
    sends += 1;
    return sends > 1 ? { ok: true } : { ok: false, error: 'inbound_delivery_failed' };
  });
  await assert.rejects(routeInboundMessageReply({}, input, fixture.dependencies), /inbound_delivery_failed/);
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), { routed: true, duplicate: true });
  assert.equal(fixture.counters.upserts, 2);
  assert.equal(sends, 2);
});
