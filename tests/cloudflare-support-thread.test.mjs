import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverSupportMessageEmail,
  routeInboundMessageReply,
} from '../functions/_lib/support-email.js';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const BUYER_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';

test('support delivery keeps provider identity separate from Cloudflare-generated RFC Message-ID', async () => {
  let replyTarget = null;
  let saved = null;
  const message = {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    company_name: 'Buyer Co',
    sender_role: 'staff',
    recipient_user_id: BUYER_ID,
    order_id: ORDER_ID,
    body: 'Your order is ready.',
  };
  const result = await deliverSupportMessageEmail({}, {}, message, {
    buyerRecipient: async () => ({ email: 'buyer@example.com', notify_messages: true, support_chat_open: false }),
    replyAddress: async (_env, value) => {
      replyTarget = value;
      return `reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`;
    },
    orderContext: async () => ({ id: ORDER_ID, reference: 'VK-100', status: 'processing' }),
    threadParent: async () => ({
      messageId: '<parent@example.com>',
      references: '<root@example.com>',
    }),
    sendEmail: async () => ({
      ok: true,
      providerMessageId: '0101018f7d0c4d9a-msg-deadbeef',
      status: 200,
      retryable: false,
    }),
    saveDelivery: async (_sb, value) => { saved = value; },
  });
  assert.equal(replyTarget, MESSAGE_ID);
  assert.deepEqual(saved, {
    messageId: MESSAGE_ID,
    deliveryId: '0101018f7d0c4d9a-msg-deadbeef',
    emailMessageId: null,
    references: '<root@example.com> <parent@example.com>',
  });
  assert.equal(result.providerMessageId, '0101018f7d0c4d9a-msg-deadbeef');
  assert.equal(result.emailMessageId, null);
  assert.equal(result.threadingPending, true);
});

test('dashboard reply continues the latest inbound RFC email thread', async () => {
  let usedReferenceFilter = false;
  let sent = null;
  const query = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    neq() { return this; },
    or(value) {
      usedReferenceFilter ||= value === 'email_message_id.not.is.null,email_references.not.is.null';
      return this;
    },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() {
      return {
        data: {
          email_message_id: null,
          email_references: '<root@example.com> <buyer-reply@example.com>',
        },
        error: null,
      };
    },
  };
  await deliverSupportMessageEmail({}, { from: () => query }, {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    company_name: 'Buyer Co',
    sender_role: 'staff',
    recipient_user_id: BUYER_ID,
    order_id: ORDER_ID,
    body: 'Tomorrow works.',
  }, {
    buyerRecipient: async () => ({ email: 'buyer@example.com', notify_messages: true, support_chat_open: false }),
    replyAddress: async () => `reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`,
    orderContext: async () => ({ id: ORDER_ID, reference: 'VK-100', status: 'processing' }),
    sendEmail: async (_env, options) => {
      sent = options;
      return { ok: true, providerMessageId: 'cf-provider-2' };
    },
    saveDelivery: async () => {},
  });
  assert.equal(usedReferenceFilter, true);
  assert.equal(sent.emailHeaders['In-Reply-To'], '<buyer-reply@example.com>');
  assert.equal(sent.emailHeaders.References, '<root@example.com> <buyer-reply@example.com>');
});

test('inbound reply address resolves the exact customer-order parent before chat upsert', async () => {
  let upserted = null;
  const input = {
    id: '<buyer-reply@example.com>',
    from: 'buyer@example.com',
    to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
    subject: 'Re: MASEST support',
    text: 'Please ship it tomorrow.',
    html: null,
    headers: {
      'message-id': '<buyer-reply@example.com>',
      'in-reply-to': '<cf-message-1@cloudflare-email.com>',
      references: '<root@example.com> <cf-message-1@cloudflare-email.com>',
    },
  };
  const result = await routeInboundMessageReply({}, input, {
    sb: {},
    messageIdFromReplyAddress: async () => MESSAGE_ID,
    replyMessage: async () => ({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      sender_role: 'staff',
      recipient_user_id: BUYER_ID,
      order_id: ORDER_ID,
    }),
    senderIdentity: async () => ({ role: 'buyer', userId: BUYER_ID }),
    upsertMessage: async (_sb, value) => {
      upserted = value;
      return {
        id: '55555555-5555-4555-8555-555555555555',
        company_id: COMPANY_ID,
        sender_role: 'buyer',
        user_id: BUYER_ID,
        order_id: ORDER_ID,
        body: value.body,
        inserted: true,
      };
    },
    deliverMessage: async () => ({ ok: true }),
  });
  assert.equal(upserted.companyId, COMPANY_ID);
  assert.equal(upserted.orderId, ORDER_ID);
  assert.equal(upserted.userId, BUYER_ID);
  assert.equal(upserted.emailId, '<buyer-reply@example.com>');
  assert.equal(
    upserted.emailReferences,
    '<root@example.com> <cf-message-1@cloudflare-email.com> <buyer-reply@example.com>',
  );
  assert.deepEqual(result, { routed: true, duplicate: false });
});

test('reply routing rejects a sender who is not the addressed buyer', async () => {
  const result = await routeInboundMessageReply({}, {
    id: '<attacker@example.com>',
    from: 'other@example.com',
    to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
    text: 'Change the order address.',
    headers: {},
  }, {
    sb: {},
    messageIdFromReplyAddress: async () => MESSAGE_ID,
    replyMessage: async () => ({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      sender_role: 'staff',
      recipient_user_id: BUYER_ID,
      order_id: ORDER_ID,
    }),
    senderIdentity: async () => ({ role: 'buyer', userId: '66666666-6666-4666-8666-666666666666' }),
  });
  assert.deepEqual(result, { routed: false, reason: 'sender_not_recipient' });
});
