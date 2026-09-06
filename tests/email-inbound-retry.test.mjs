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

function retryDependencies() {
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
    },
  };
}

test('inbound retry reconciles duplicate atomic chat append without synchronous email send', async () => {
  let sends = 0;
  const fixture = retryDependencies();
  fixture.dependencies.deliverMessage = async () => {
    sends += 1;
    return { ok: true };
  };
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), { routed: true, duplicate: false });
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), { routed: true, duplicate: true });
  assert.equal(fixture.counters.upserts, 2);
  assert.equal(sends, 0);
});

test('inbound routing fails before upsert when durable readiness is unavailable', async () => {
  let upserts = 0;
  const fixture = retryDependencies();
  fixture.dependencies.sb = { rpc: async () => ({ error: new Error('not ready') }) };
  fixture.dependencies.upsertMessage = async () => { upserts += 1; };
  await assert.rejects(routeInboundMessageReply({}, input, fixture.dependencies), (error) => (
    error.code === 'durable_email_effects_not_ready'
  ));
  assert.equal(upserts, 0);
});
