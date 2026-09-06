import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverSupportMessageEmail,
  routeInboundMessageReply,
} from '../functions/_lib/support-email.js';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const BUYER_ID = '00000000-0000-4000-8000-000000000002';
const STAFF_ID = '00000000-0000-4000-8000-000000000004';
const ORDER_ID = '00000000-0000-4000-8000-000000000003';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000005';
const THREAD_ID = '00000000-0000-4000-8000-000000000006';

test('staff message uses canonical email gateway with exact buyer, order, and RFC thread', async () => {
  let sent;
  let saved;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    company_name: 'Northwind HVAC',
    sender_role: 'staff',
    body: 'Your replacement is approved.',
    sender_name: 'Maya',
    created_at: '2026-09-03T14:42:00Z',
    order_id: ORDER_ID,
    recipient_user_id: BUYER_ID,
  }, {
    buyerRecipient: async () => ({
      id: BUYER_ID,
      email: 'buyer@example.com',
      notify_messages: true,
      support_chat_open: false,
    }),
    orderContext: async () => ({ id: ORDER_ID, reference: 'VK-1042', status: 'shipped' }),
    replyAddress: async (_env, value) => {
      assert.equal(value, MESSAGE_ID);
      return `reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`;
    },
    threadParent: async () => ({
      messageId: '<prior-buyer-visible@example.com>',
      references: '<root-buyer-visible@example.com>',
      history: [{
        sender_role: 'buyer',
        body: 'Is this the right chemistry?',
        created_at: '2026-09-03T14:31:00Z',
      }],
    }),
    sendEmail: async (_env, options) => {
      sent = options;
      return { ok: true, providerMessageId: 'cf-provider-out-2' };
    },
    prepareDelivery: async (_sb, _id, envelope) => envelope,
    saveDelivery: async (_sb, input) => { saved = input; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'cf-provider-out-2');
  assert.deepEqual(sent.to, ['buyer@example.com']);
  assert.match(sent.replyTo, /^reply\+/);
  assert.equal(sent.emailHeaders['In-Reply-To'], '<prior-buyer-visible@example.com>');
  assert.equal(sent.emailHeaders.References, '<root-buyer-visible@example.com> <prior-buyer-visible@example.com>');
  assert.equal(sent.emailHeaders['Thread-Topic'], undefined);
  assert.match(sent.subject, /^Re: MASEST support · Northwind HVAC · Order VK-1042$/);
  assert.match(sent.html, /Order VK-1042/);
  assert.match(sent.html, /View conversation online/);
  assert.match(sent.html, /Reply directly to this email/);
  assert.match(sent.html, /Earlier in this conversation/);
  assert.match(sent.html, /Is this the right chemistry\?/);
  assert.match(sent.text, /Your replacement is approved/);
  assert.equal(sent.idempotencyKey, `support-message/${MESSAGE_ID}/staff`);
  assert.deepEqual(saved, {
    messageId: MESSAGE_ID,
    deliveryId: 'cf-provider-out-2',
    emailMessageId: null,
    references: '<root-buyer-visible@example.com> <prior-buyer-visible@example.com>',
  });
});

test('staff delivery distinguishes missing email and exact prior delivery', async () => {
  const missing = await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    sender_role: 'staff',
    body: 'Account update',
    recipient_user_id: BUYER_ID,
  }, {
    buyerRecipient: async () => ({ email: null, notify_messages: true, support_chat_open: false }),
  });
  assert.deepEqual(missing, { ok: true, skipped: 'recipient_email_missing' });

  let sends = 0;
  const existing = await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    sender_role: 'staff',
    body: 'Account update',
    recipient_user_id: BUYER_ID,
    email_delivery_id: 'cf-existing',
    email_message_id: null,
    email_references: '<root@example.com>',
  }, {
    sendEmail: async () => { sends += 1; return { ok: true, providerMessageId: 'wrong' }; },
  });
  assert.equal(sends, 0);
  assert.deepEqual(existing, {
    ok: true,
    skipped: 'already_delivered',
    providerMessageId: 'cf-existing',
    emailMessageId: null,
    references: '<root@example.com>',
  });
});

test('buyer message emails opted-in admins through the same message-addressed thread', async () => {
  let sent;
  const result = await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
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
    replyAddress: async () => `reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`,
    threadParent: async () => null,
    sendEmail: async (_env, options) => {
      sent = options;
      return { ok: true, providerMessageId: 'cf-provider-out-3' };
    },
    saveDelivery: async () => {},
    prepareDelivery: async (_sb, _id, envelope) => envelope,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.to, ['support@masest.co']);
  assert.equal(sent.category, 'staff_alert');
  assert.match(sent.subject, /^MASEST support · Northwind HVAC · Order VK-1042$/);
  assert.deepEqual(sent.emailHeaders, {});
  assert.match(sent.html, /Can you confirm tracking\?/);
});

test('support retry reuses the first persisted envelope after context changes', async () => {
  let persisted;
  const requests = [];
  const base = { id: MESSAGE_ID, company_id: COMPANY_ID, sender_role: 'staff', recipient_user_id: BUYER_ID,
    order_id: ORDER_ID, body: 'Original support update', company_name: 'Original Co' };
  const dependencies = {
    buyerRecipient: async () => ({ email: 'buyer@example.com', notify_messages: true, support_chat_open: false }),
    replyAddress: async () => 'reply+stable@reply.masest.co',
    orderContext: async () => ({ id: ORDER_ID, reference: 'ORIGINAL-ORDER', status: 'shipped' }),
    threadParent: async () => null,
    prepareDelivery: async (_sb, _id, envelope) => persisted || (persisted = envelope),
    sendEmail: async (_env, options) => { requests.push(options); return { ok: true, providerMessageId: `provider-${requests.length}` }; },
    saveDelivery: async () => {},
  };
  await deliverSupportMessageEmail({}, {}, base, dependencies);
  await deliverSupportMessageEmail({}, {}, { ...base, body: 'Changed after retry', company_name: 'Changed Co' }, dependencies);
  assert.deepEqual(requests[1], requests[0]);
});

test('support envelope storage is kept on the private effect preparation seam', async () => {
  const migration = await (await import('node:fs/promises')).readFile(
    new URL('../supabase/migrate-support-email-envelope-2026-09-05.sql', import.meta.url), 'utf8',
  );
  assert.match(migration, /alter table public\.integration_effects[\s\S]+delivery_request/);
  assert.doesNotMatch(migration, /alter table public\.messages[\s\S]+email_delivery_request/);
  assert.match(migration, /revoke all on function public\.prepare_support_email_delivery/);
  assert.match(migration, /grant execute on function public\.prepare_support_email_delivery[^\n]+ to service_role/);
  const durable = await (await import('node:fs/promises')).readFile(
    new URL('../supabase/migrate-durable-support-message-effects-2026-09-05.sql', import.meta.url), 'utf8',
  );
  assert.match(durable, /to_regprocedure\('public\.prepare_support_email_delivery\(uuid,jsonb\)'\)/);
});

test('customer and staff email replies append through canonical chat with exact linked order', async () => {
  for (const senderRole of ['buyer', 'staff']) {
    let upserted;
    let delivered;
    const parent = senderRole === 'buyer'
      ? {
          id: MESSAGE_ID,
          thread_id: THREAD_ID,
          company_id: COMPANY_ID,
          sender_role: 'staff',
          user_id: STAFF_ID,
          recipient_user_id: BUYER_ID,
          order_id: ORDER_ID,
        }
      : {
          id: MESSAGE_ID,
          thread_id: THREAD_ID,
          company_id: COMPANY_ID,
          sender_role: 'buyer',
          user_id: BUYER_ID,
          recipient_user_id: null,
          order_id: ORDER_ID,
        };
    const result = await routeInboundMessageReply({}, {
      id: `email-${senderRole}`,
      from: senderRole === 'buyer' ? 'buyer@example.com' : 'support@masest.co',
      to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
      text: `${senderRole} reply`,
      headers: {
        'message-id': `<incoming-${senderRole}@example.com>`,
        'in-reply-to': '<outbound-parent@example.com>',
        references: '<root@example.com> <outbound-parent@example.com>',
      },
    }, {
      sb: {},
      messageIdFromReplyAddress: async () => MESSAGE_ID,
      replyMessage: async () => parent,
      replyThread: async () => ({
        id: THREAD_ID,
        participant_user_id: BUYER_ID,
        company_id: COMPANY_ID,
      }),
      senderIdentity: async () => ({
        role: senderRole,
        userId: senderRole === 'buyer' ? BUYER_ID : STAFF_ID,
      }),
      upsertMessage: async (_sb, input) => {
        upserted = input;
        return {
          id: `message-${senderRole}`,
          company_id: COMPANY_ID,
          sender_role: senderRole,
          user_id: senderRole === 'buyer' ? BUYER_ID : null,
          recipient_user_id: senderRole === 'staff' ? BUYER_ID : null,
          body: `${senderRole} reply`,
          order_id: ORDER_ID,
          inserted: true,
        };
      },
      deliverMessage: async (_env, _sb, message) => { delivered = message; return { ok: true }; },
    });

    assert.deepEqual(result, { routed: true, duplicate: false });
    assert.equal(upserted.senderRole, senderRole);
    assert.equal(upserted.threadId, THREAD_ID);
    assert.equal(upserted.orderId, ORDER_ID);
    assert.equal(upserted.recipientUserId, senderRole === 'staff' ? BUYER_ID : null);
    assert.equal(
      upserted.emailReferences,
      `<root@example.com> <outbound-parent@example.com> <incoming-${senderRole}@example.com>`,
    );
    assert.equal(delivered, undefined);
  }
});

test('unrecognized inbound sender never enters support chat', async () => {
  let upserts = 0;
  const result = await routeInboundMessageReply({}, {
    id: 'email-unknown',
    from: 'attacker@example.com',
    to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
    text: 'inject me',
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
    senderIdentity: async () => null,
    upsertMessage: async () => { upserts += 1; },
  });
  assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
  assert.equal(upserts, 0);
});
