import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverSupportMessageEmail,
  routeInboundMessageReply,
} from '../functions/_lib/support-email.js';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const BUYER_ID = '00000000-0000-4000-8000-000000000002';
const ORDER_ID = '00000000-0000-4000-8000-000000000003';

test('staff support messages email their selected user with order context and RFC thread headers', async () => {
  let sent;
  let saved;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: 'message-2',
    company_id: COMPANY_ID,
    company_name: 'Northwind HVAC',
    sender_role: 'staff',
    body: 'Your replacement is approved.',
    order_id: ORDER_ID,
    recipient_user_id: BUYER_ID,
  }, {
    buyerRecipient: async () => ({
      id: BUYER_ID,
      email: 'buyer@example.com',
      full_name: 'Morgan Buyer',
      notify_messages: true,
      support_chat_open: false,
    }),
    orderContext: async () => ({ id: ORDER_ID, reference: 'VK-1042', status: 'shipped' }),
    replyAddress: async () => 'reply+signed@example.resend.app',
    threadParent: async () => ({
      messageId: '<prior-buyer-visible@resend.dev>',
      references: '<root-buyer-visible@resend.dev>',
    }),
    sendEmail: async (_env, options) => {
      sent = options;
      return { ok: true, resendId: 'resend-out-2' };
    },
    sentEmail: async () => ({ message_id: '<current-buyer-visible@resend.dev>' }),
    saveDelivery: async (_sb, input) => { saved = input; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sent.to, ['buyer@example.com']);
  assert.equal(sent.replyTo, 'reply+signed@example.resend.app');
  assert.equal(sent.emailHeaders['In-Reply-To'], '<prior-buyer-visible@resend.dev>');
  assert.equal(sent.emailHeaders.References, '<root-buyer-visible@resend.dev> <prior-buyer-visible@resend.dev>');
  assert.match(sent.subject, /^Re: MASEST support · Northwind HVAC$/);
  assert.match(sent.html, /Order VK-1042/);
  assert.deepEqual(saved, {
    messageId: 'message-2',
    deliveryId: 'resend-out-2',
    emailMessageId: '<current-buyer-visible@resend.dev>',
    references: '<root-buyer-visible@resend.dev> <prior-buyer-visible@resend.dev>',
  });
});

test('staff delivery reports a missing account email instead of mislabeling live-chat presence', async () => {
  const result = await deliverSupportMessageEmail({}, {}, {
    id: 'message-no-email',
    company_id: COMPANY_ID,
    sender_role: 'staff',
    body: 'Account update',
    recipient_user_id: BUYER_ID,
  }, {
    buyerRecipient: async () => ({
      id: BUYER_ID,
      email: null,
      notify_messages: true,
      support_chat_open: false,
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    skipped: 'recipient_email_missing',
  });
});

test('a sent support email resumes RFC metadata capture without sending twice', async () => {
  let sends = 0;
  let saved;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: 'message-recover',
    company_id: COMPANY_ID,
    sender_role: 'staff',
    body: 'Account update',
    recipient_user_id: BUYER_ID,
    email_delivery_id: 'resend-existing',
    email_message_id: null,
    email_references: '<root@resend.dev>',
  }, {
    sendEmail: async () => { sends += 1; return { ok: true, resendId: 'wrong' }; },
    sentEmail: async () => ({ message_id: '<recovered@resend.dev>' }),
    saveDelivery: async (_sb, input) => { saved = input; },
  });

  assert.equal(sends, 0);
  assert.equal(result.ok, true);
  assert.equal(result.emailMessageId, '<recovered@resend.dev>');
  assert.deepEqual(saved, {
    messageId: 'message-recover',
    deliveryId: 'resend-existing',
    emailMessageId: '<recovered@resend.dev>',
    references: '<root@resend.dev>',
  });
});

test('sent email remains successful while RFC metadata waits for webhook projection', async () => {
  let saved;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: 'message-pending-rfc',
    company_id: COMPANY_ID,
    sender_role: 'buyer',
    user_id: BUYER_ID,
    body: 'Need help',
  }, {
    adminRecipients: async () => ['support@masest.co'],
    replyAddress: async () => 'reply+signed@example.resend.app',
    orderContext: async () => null,
    threadParent: async () => null,
    sendEmail: async () => ({ ok: true, resendId: 'resend-pending-rfc' }),
    sentEmail: async () => ({}),
    saveDelivery: async (_sb, input) => { saved = input; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.threadingPending, true);
  assert.deepEqual(saved, {
    messageId: 'message-pending-rfc',
    deliveryId: 'resend-pending-rfc',
    emailMessageId: null,
    references: null,
  });
});

test('buyer support messages email opted-in admins through the same reply-to thread', async () => {
  let sent;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: 'message-3',
    company_id: COMPANY_ID,
    company_name: 'Northwind HVAC',
    sender_role: 'buyer',
    user_id: BUYER_ID,
    body: 'Can you confirm tracking?',
    order_id: ORDER_ID,
    previous_sender_role: 'staff',
    prior_thread_status: 'open',
  }, {
    adminRecipients: async () => ['support@masest.co'],
    orderContext: async () => ({ id: ORDER_ID, reference: 'VK-1042', status: 'shipped' }),
    replyAddress: async () => 'reply+signed@example.resend.app',
    threadParent: async () => null,
    sendEmail: async (_env, options) => {
      sent = options;
      return { ok: true, resendId: 'resend-out-3' };
    },
    sentEmail: async () => ({ message_id: '<current-staff-visible@resend.dev>' }),
    saveDelivery: async () => {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sent.to, ['support@masest.co']);
  assert.equal(sent.replyTo, 'reply+signed@example.resend.app');
  assert.match(sent.subject, /^MASEST support · Northwind HVAC$/);
  assert.match(sent.html, /Can you confirm tracking\?/);
});

test('email replies from customers and staff both append through canonical chat delivery', async () => {
  for (const senderRole of ['buyer', 'staff']) {
    let upserted;
    let delivered;
    const sender = senderRole === 'buyer' ? 'buyer@example.com' : 'support@masest.co';
    const result = await routeInboundMessageReply({}, { data: { email_id: `email-${senderRole}` } }, {
      receivedEmail: async () => ({ data: {
        from: sender,
        to: ['reply+signed@example.resend.app'],
        text: `${senderRole} reply`,
        message_id: `<incoming-${senderRole}@example.com>`,
        headers: {
          'in-reply-to': '<outbound-parent@resend.dev>',
          references: '<root@resend.dev> <outbound-parent@resend.dev>',
        },
      } }),
      companyIdFromReplyAddress: async () => COMPANY_ID,
      senderIdentity: async () => ({ role: senderRole, userId: senderRole === 'buyer' ? BUYER_ID : null }),
      replyContext: async () => ({ recipientUserId: BUYER_ID, orderId: ORDER_ID }),
      upsertMessage: async (_sb, input) => {
        upserted = input;
        return {
          id: `message-${senderRole}`,
          message_id: `message-${senderRole}`,
          company_id: COMPANY_ID,
          company_name: 'Northwind HVAC',
          sender_role: senderRole,
          user_id: senderRole === 'buyer' ? BUYER_ID : null,
          recipient_user_id: senderRole === 'staff' ? BUYER_ID : null,
          body: `${senderRole} reply`,
          order_id: ORDER_ID,
          inserted: true,
          previous_sender_role: senderRole === 'buyer' ? 'staff' : 'buyer',
          prior_thread_status: 'open',
        };
      },
      deliverMessage: async (_env, _sb, message) => { delivered = message; return { ok: true }; },
      sb: {},
    });

    assert.deepEqual(result, { routed: true, duplicate: false });
    assert.equal(upserted.senderRole, senderRole);
    assert.equal(upserted.orderId, ORDER_ID);
    assert.equal(upserted.recipientUserId, senderRole === 'staff' ? BUYER_ID : null);
    assert.equal(delivered.sender_role, senderRole);
  }
});

test('inbound reply context prefers In-Reply-To over older References ancestors', async () => {
  let candidates;
  let upserted;
  const sb = {
    from(table) {
      assert.equal(table, 'messages');
      return {
        select() { return this; },
        eq() { return this; },
        in(_column, values) {
          candidates = values;
          return Promise.resolve({
            data: [
              { email_message_id: '<root@resend.dev>', sender_role: 'staff', recipient_user_id: BUYER_ID, order_id: null },
              { email_message_id: '<parent@resend.dev>', sender_role: 'staff', recipient_user_id: BUYER_ID, order_id: ORDER_ID },
            ],
            error: null,
          });
        },
      };
    },
  };
  const result = await routeInboundMessageReply({}, { data: { email_id: 'email-parent' } }, {
    sb,
    receivedEmail: async () => ({ data: {
      from: 'buyer@example.com',
      to: ['reply+signed@example.resend.app'],
      text: 'Reply about this order',
      headers: {
        'in-reply-to': '<parent@resend.dev>',
        references: '<root@resend.dev> <parent@resend.dev>',
      },
    } }),
    companyIdFromReplyAddress: async () => COMPANY_ID,
    senderIdentity: async () => ({ role: 'buyer', userId: BUYER_ID }),
    upsertMessage: async (_client, input) => {
      upserted = input;
      return {
        id: 'message-parent-reply',
        company_id: COMPANY_ID,
        sender_role: 'buyer',
        user_id: BUYER_ID,
        body: input.body,
        order_id: input.orderId,
        inserted: true,
      };
    },
    deliverMessage: async () => ({ ok: true }),
  });

  assert.deepEqual(result, { routed: true, duplicate: false });
  assert.deepEqual(candidates, ['<parent@resend.dev>', '<root@resend.dev>']);
  assert.equal(upserted.orderId, ORDER_ID);
});

test('unrecognized inbound senders never enter support chat', async () => {
  let upserts = 0;
  const result = await routeInboundMessageReply({}, { data: { email_id: 'email-unknown' } }, {
    receivedEmail: async () => ({ data: {
      from: 'attacker@example.com',
      to: ['reply+signed@example.resend.app'],
      text: 'inject me',
    } }),
    companyIdFromReplyAddress: async () => COMPANY_ID,
    senderIdentity: async () => null,
    upsertMessage: async () => { upserts += 1; },
    sb: {},
  });

  assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
  assert.equal(upserts, 0);
});
