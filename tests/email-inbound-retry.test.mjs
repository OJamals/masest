import assert from 'node:assert/strict';
import test from 'node:test';

import { routeInboundMessageReply } from '../functions/_lib/support-email.js';
import { createEmailInboundHandler } from '../functions/api/email/inbound.js';

const parent = {
  id: '00000000-0000-4000-8000-000000000009',
  company_id: '00000000-0000-4000-8000-000000000001',
  sender_role: 'staff',
  recipient_user_id: 'user-1',
  user_id: 'staff-1',
  order_id: 'order-1',
  ticket_id: '00000000-0000-4000-8000-000000000010',
};
const input = {
  id: 'email-1',
  from: 'buyer@example.com',
  to: ['reply+00000000-0000-4000-8000-000000000009.token@reply.masest.co'],
  text: 'Please update my order.',
};

function retryDependencies(attemptDelivery) {
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
        ticket_id: parent.ticket_id,
        body: input.text,
        inserted: upserts++ === 0,
        company_name: 'Buyer Co',
      }),
      createDeliveryWorkerId: () => 'support-immediate/inbound-1',
      attemptDelivery,
    },
  };
}

test('inbound response-loss retry reconciles the duplicate through its exact durable effect', async () => {
  let attempts = 0;
  const fixture = retryDependencies(async ({ message, workerId }) => {
    attempts += 1;
    assert.equal(message.id, 'message-1');
    assert.equal(workerId, 'support-immediate/inbound-1');
    return attempts === 1
      ? { state: 'queued', effect_id: 'effect-1' }
      : { state: 'delivered', effect_id: 'effect-1' };
  });
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), {
    routed: true, duplicate: false, email_delivery: { state: 'queued', effect_id: 'effect-1' },
  });
  assert.deepEqual(await routeInboundMessageReply({}, input, fixture.dependencies), {
    routed: true, duplicate: true, email_delivery: { state: 'delivered', effect_id: 'effect-1' },
  });
  assert.equal(fixture.counters.upserts, 2);
  assert.equal(attempts, 2);
});

test('inbound legacy duplicate exposes operator attention without fabricating retry durability', async () => {
  const fixture = retryDependencies(async () => ({
    state: 'dead', effect_id: null, reason: 'legacy_delivery_effect_missing',
  }));
  const response = await routeInboundMessageReply({}, input, fixture.dependencies);
  assert.deepEqual(response, {
    routed: true,
    duplicate: false,
    email_delivery: {
      state: 'dead', effect_id: null, reason: 'legacy_delivery_effect_missing',
    },
    reason: 'legacy_delivery_effect_missing',
  });
});

test('inbound Request boundary preserves safe durable-delivery operator attention', async (t) => {
  for (const [deliveryReason, publicReason] of [
    ['legacy_delivery_effect_missing', 'legacy_delivery_effect_missing'],
    ['support_delivery_status_unavailable', 'support_delivery_status_unavailable'],
    ['Database connection failed: private detail', 'support_delivery_attention_required'],
  ]) {
    await t.test(publicReason, async () => {
      const fixture = retryDependencies(async () => ({
        state: 'dead', effect_id: null, reason: deliveryReason,
      }));
      const handler = createEmailInboundHandler({
        verifiedJson: async () => input,
        routeInbound: (env, value) => routeInboundMessageReply(env, value, fixture.dependencies),
      });
      const response = await handler({
        request: new Request('https://masest.test/api/email/inbound', { method: 'POST' }),
        env: {},
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        routed: true,
        duplicate: false,
        reason: publicReason,
      });
    });
  }
});

test('inbound Request boundary exposes a retryable maintenance pause', async () => {
  const handler = createEmailInboundHandler({
    verifiedJson: async () => input,
    routeInbound: async () => { throw new Error('support_writes_paused'); },
  });
  const response = await handler({
    request: new Request('https://masest.test/api/email/inbound', { method: 'POST' }), env: {},
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(await response.json(), { error: 'support_writes_paused', retryable: true });
});
