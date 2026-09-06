import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverSupportMessageEmail,
  routeInboundMessageReply,
} from '../functions/_lib/support-email.js';
import { renderSupportEmail } from '../functions/_lib/email-renderers.js';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const BUYER_ID = '00000000-0000-4000-8000-000000000002';
const STAFF_ID = '00000000-0000-4000-8000-000000000004';
const ORDER_ID = '00000000-0000-4000-8000-000000000003';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000005';
const THREAD_ID = '00000000-0000-4000-8000-000000000006';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000007';
const TICKET_ID = '00000000-0000-4000-8000-000000000008';

function senderResolutionDb({ buyerProfiles = [], staffProfiles = [], emails = {} } = {}) {
  const queryCalls = [];
  const authCalls = [];
  const upsertCalls = [];
  const violations = [];

  function from(table) {
    if (table !== 'profiles') {
      violations.push(`unexpected table ${table}`);
      throw new Error(`unexpected fake table ${table}`);
    }
    let selected = null;
    const filters = [];
    let settled = false;
    let builder;
    const target = {
      select(columns) {
        if (selected !== null) {
          violations.push(`duplicate select on ${table}`);
          throw new Error(`duplicate fake select on ${table}`);
        }
        selected = columns;
        return builder;
      },
      eq(column, value) {
        filters.push([column, value]);
        return builder;
      },
      then(resolve, reject) {
        if (settled) {
          const error = new Error(`duplicate fake query settlement on ${table}`);
          violations.push(error.message);
          return Promise.reject(error).then(resolve, reject);
        }
        settled = true;
        const call = { table, selected, filters };
        queryCalls.push(call);
        const buyerQuery = selected === 'id'
          && filters.length === 1
          && filters[0][0] === 'id'
          && filters[0][1] === BUYER_ID;
        const staffQuery = ['id,is_staff', 'id,is_staff,staff_role'].includes(selected)
          && filters.length === 1
          && filters[0][0] === 'is_staff'
          && filters[0][1] === true;
        if (!buyerQuery && !staffQuery) {
          const error = new Error(`unexpected fake query ${JSON.stringify(call)}`);
          violations.push(error.message);
          return Promise.reject(error).then(resolve, reject);
        }
        return Promise.resolve({
          data: buyerQuery ? buyerProfiles : staffProfiles,
          error: null,
        }).then(resolve, reject);
      },
    };
    builder = new Proxy(target, {
      get(object, property, receiver) {
        if (Reflect.has(object, property)) return Reflect.get(object, property, receiver);
        if (typeof property === 'symbol') return undefined;
        return (...args) => {
          violations.push(`unexpected method ${String(property)}(${JSON.stringify(args)}) on ${table}`);
          throw new Error(`unexpected fake method ${String(property)} on ${table}`);
        };
      },
    });
    return builder;
  }

  const sb = {
    from,
    auth: {
      admin: {
        async getUserById(id) {
          authCalls.push(id);
          if (!Object.hasOwn(emails, id)) {
            violations.push(`unexpected Auth getUserById(${id})`);
            return { data: null, error: new Error('unexpected fake Auth lookup') };
          }
          return { data: { user: { id, email: emails[id] } }, error: null };
        },
      },
    },
    async rpc(name, args) {
      if (name !== 'upsert_email_inbound_message') {
        violations.push(`unexpected RPC ${name}`);
        throw new Error(`unexpected fake RPC ${name}`);
      }
      upsertCalls.push(args);
      return {
        data: {
          message_id: `00000000-0000-4000-8000-${String(upsertCalls.length).padStart(12, '0')}`,
          inserted: true,
        },
        error: null,
      };
    },
    assertClean({ upserts = 0, staffColumns = 'id,is_staff,staff_role' } = {}) {
      assert.equal(upsertCalls.length, upserts, 'unexpected canonical message upsert count');
      assert.deepEqual(violations, [], violations.join('\n'));
      const normalizedQueries = queryCalls.map((call) => JSON.stringify(call)).sort();
      assert.deepEqual(normalizedQueries, [
        JSON.stringify({ table: 'profiles', selected: 'id', filters: [['id', BUYER_ID]] }),
        JSON.stringify({ table: 'profiles', selected: staffColumns, filters: [['is_staff', true]] }),
      ].sort());
      const expectedAuthCalls = [...new Set([
        ...buyerProfiles.map((profile) => profile.id),
        ...staffProfiles.map((profile) => profile.id),
      ])].sort();
      assert.deepEqual([...authCalls].sort(), expectedAuthCalls);
    },
    upsertCalls,
  };
  return sb;
}

function inboundReply(sender, suffix) {
  return {
    id: `email-${suffix}`,
    from: sender,
    to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
    text: 'Reply from email',
    headers: { 'message-id': `<incoming-${suffix}@example.test>` },
  };
}

function replyThread() {
  return {
    id: THREAD_ID,
    participant_user_id: BUYER_ID,
    company_id: COMPANY_ID,
  };
}

function parentFromBuyer() {
  return {
    id: MESSAGE_ID,
    thread_id: THREAD_ID,
    company_id: COMPANY_ID,
    sender_role: 'buyer',
    user_id: BUYER_ID,
    recipient_user_id: null,
    order_id: ORDER_ID,
    ticket_id: TICKET_ID,
  };
}

function parentFromStaff(overrides = {}) {
  return {
    id: MESSAGE_ID,
    thread_id: THREAD_ID,
    company_id: COMPANY_ID,
    sender_role: 'staff',
    user_id: STAFF_ID,
    recipient_user_id: BUYER_ID,
    order_id: ORDER_ID,
    ticket_id: TICKET_ID,
    ...overrides,
  };
}

async function routeWithResolvedSender({ db, sender, suffix, parent, env = {} }) {
  const deliveries = [];
  const result = await routeInboundMessageReply(env, inboundReply(sender, suffix), {
    sb: db,
    messageIdFromReplyAddress: async () => MESSAGE_ID,
    replyMessage: async () => parent,
    replyThread: async () => replyThread(),
    deliverMessage: async (_env, _sb, message) => {
      deliveries.push(message);
      return { ok: true };
    },
  });
  return { result, deliveries };
}

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
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.to, ['support@masest.co']);
  assert.equal(sent.category, 'staff_alert');
  assert.match(sent.subject, /^MASEST support · Northwind HVAC · Order VK-1042$/);
  assert.deepEqual(sent.emailHeaders, {});
  assert.match(sent.html, /Can you confirm tracking\?/);
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
          ticket_id: TICKET_ID,
        }
      : {
          id: MESSAGE_ID,
          thread_id: THREAD_ID,
          company_id: COMPANY_ID,
          sender_role: 'buyer',
          user_id: BUYER_ID,
          recipient_user_id: null,
          order_id: ORDER_ID,
          ticket_id: TICKET_ID,
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
    assert.equal(upserted.ticketId, TICKET_ID);
    assert.equal(upserted.recipientUserId, senderRole === 'staff' ? BUYER_ID : null);
    assert.equal(
      upserted.emailReferences,
      `<root@example.com> <outbound-parent@example.com> <incoming-${senderRole}@example.com>`,
    );
    assert.equal(delivered.sender_role, senderRole);
    assert.equal(delivered.order_id, ORDER_ID);
  }
});

test('signed parent ticket is invariant when inbound subject and threading headers are changed, stripped, or forged', async () => {
  const parent = parentFromStaff();
  const inputs = [
    { subject: 'Re: [MAS-999999] forged', headers: {} },
    { subject: 'totally unrelated', headers: { references: '<forged@example.test>' } },
    { subject: '', headers: { 'in-reply-to': '<attacker@example.test>', 'message-id': '<new@example.test>' } },
  ];
  for (const [index, override] of inputs.entries()) {
    let upserted;
    await routeInboundMessageReply({}, {
      id: `subject-invariant-${index}`,
      from: 'buyer@example.com',
      to: [`reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`],
      text: 'Authoritative parent remains unchanged.',
      ...override,
    }, {
      sb: {},
      messageIdFromReplyAddress: async () => MESSAGE_ID,
      replyMessage: async () => parent,
      replyThread: async () => replyThread(),
      senderIdentity: async () => ({ role: 'buyer', userId: BUYER_ID }),
      upsertMessage: async (_sb, input) => {
        upserted = input;
        return { id: `routed-${index}`, inserted: true, ticket_id: TICKET_ID };
      },
      deliverMessage: async () => ({ ok: true }),
    });
    assert.equal(upserted.ticketId, TICKET_ID);
    assert.equal(upserted.orderId, ORDER_ID);
  }
});

test('support delivery loads the exact message ticket and renderer escapes ticket display subject', async () => {
  let requestedTicketId;
  let sent;
  await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
    ticket_id: TICKET_ID,
    company_id: COMPANY_ID,
    company_name: 'Northwind HVAC',
    sender_role: 'staff',
    recipient_user_id: BUYER_ID,
    body: 'Use the attached process guidance.',
  }, {
    buyerRecipient: async () => ({ email: 'buyer@example.com', notify_messages: true, support_chat_open: false }),
    ticketContext: async (_sb, ticketId) => {
      requestedTicketId = ticketId;
      return { id: ticketId, ticket_number: 123, subject: 'Pump-room <scaling & "biofilm">' };
    },
    orderContext: async () => null,
    threadParent: async () => null,
    replyAddress: async () => 'reply+safe@reply.masest.co',
    sendEmail: async (_env, options) => { sent = options; return { ok: true, providerMessageId: '<delivery@example.test>' }; },
    saveDelivery: async () => {},
  });
  assert.equal(requestedTicketId, TICKET_ID);
  assert.equal(sent.subject, '[MAS-000123] MASEST support · Pump-room <scaling & "biofilm">');
  assert.match(sent.html, /\[MAS-000123\]/);
  assert.match(sent.html, /Pump-room &lt;scaling &amp; &quot;biofilm&quot;&gt;/);

  const rendered = renderSupportEmail({
    thread: { headers: { 'In-Reply-To': '<parent@example.test>' } },
    message: { sender_role: 'staff', body: 'Reply' },
    participant: { name: 'Northwind HVAC' },
    ticket: { display_number: 'MAS-000123', subject: 'Pump-room scaling' },
  });
  assert.equal(rendered.subject, 'Re: [MAS-000123] MASEST support · Pump-room scaling');
});

test('support delivery query does not inherit parent headers or history from another ticket', async () => {
  const filters = [];
  const priorOtherTicket = [{
    id: 'old-message',
    email_message_id: '<old-ticket@example.test>',
    email_references: '<old-root@example.test>',
    sender_role: 'buyer',
    body: 'Old ticket history',
    created_at: '2026-09-01T12:00:00Z',
  }];
  const builder = {
    select() { return this; },
    or() { return this; },
    order() { return this; },
    limit() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    neq() { return this; },
    is() { return this; },
    then(resolve, reject) {
      const exactTicket = filters.some(([column, value]) => column === 'ticket_id' && value === TICKET_ID);
      return Promise.resolve({ data: exactTicket ? [] : priorOtherTicket, error: null }).then(resolve, reject);
    },
  };
  let sent;
  await deliverSupportMessageEmail({}, { from: () => builder }, {
    id: MESSAGE_ID,
    thread_id: THREAD_ID,
    ticket_id: TICKET_ID,
    company_id: COMPANY_ID,
    company_name: 'Northwind HVAC',
    sender_role: 'staff',
    recipient_user_id: BUYER_ID,
    body: 'First message in this ticket.',
  }, {
    buyerRecipient: async () => ({ email: 'buyer@example.com', notify_messages: true, support_chat_open: false }),
    ticketContext: async () => ({ id: TICKET_ID, ticket_number: 124, subject: 'New issue' }),
    orderContext: async () => null,
    replyAddress: async () => 'reply+safe@reply.masest.co',
    sendEmail: async (_env, options) => { sent = options; return { ok: true, providerMessageId: 'delivery-2' }; },
    saveDelivery: async () => {},
  });

  assert.deepEqual(filters, [['thread_id', THREAD_ID], ['ticket_id', TICKET_ID]]);
  assert.deepEqual(sent.emailHeaders, {});
  assert.doesNotMatch(sent.html, /Old ticket history/);
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

test('write-capable database platform staff email replies route as staff', async (t) => {
  for (const role of ['owner', 'finance', 'support']) {
    await t.test(role, async () => {
      const address = `${role}@example.test`;
      const db = senderResolutionDb({
        staffProfiles: [{ id: STAFF_ID, is_staff: true, staff_role: role }],
        emails: { [STAFF_ID]: address },
      });
      const { result, deliveries } = await routeWithResolvedSender({
        db,
        sender: address,
        suffix: `staff-${role}`,
        parent: parentFromBuyer(),
      });

      db.assertClean({ upserts: 1 });
      assert.equal(deliveries.length, 1);
      assert.equal(db.upsertCalls[0].p_sender_role, 'staff');
      assert.equal(db.upsertCalls[0].p_recipient_user_id, BUYER_ID);
      assert.deepEqual(result, { routed: true, duplicate: false });
    });
  }
});

test('read-only platform staff email reply never creates a message or delivery', async () => {
  const address = 'read-only@example.test';
  const db = senderResolutionDb({
    staffProfiles: [{ id: STAFF_ID, is_staff: true, staff_role: 'read_only' }],
    emails: { [STAFF_ID]: address },
  });
  const { result, deliveries } = await routeWithResolvedSender({
    db,
    sender: address,
    suffix: 'read-only',
    parent: parentFromBuyer(),
  });

  db.assertClean({ upserts: 0 });
  assert.equal(deliveries.length, 0);
  assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
});

test('missing, unknown, malformed, or non-staff database roles fail closed', async (t) => {
  const cases = [
    ['missing role', null, true],
    ['unknown role', 'warehouse', true],
    ['malformed role', ['owner'], true],
    ['is_staff false', 'owner', false],
  ];
  for (const [name, staffRole, isStaff] of cases) {
    await t.test(name, async () => {
      const address = `${name.replaceAll(' ', '-')}@example.test`;
      const db = senderResolutionDb({
        staffProfiles: [{ id: STAFF_ID, is_staff: isStaff, staff_role: staffRole }],
        emails: { [STAFF_ID]: address },
      });
      const { result, deliveries } = await routeWithResolvedSender({
        db,
        sender: address,
        suffix: name.replaceAll(' ', '-'),
        parent: parentFromBuyer(),
      });

      db.assertClean({ upserts: 0 });
      assert.equal(deliveries.length, 0);
      assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
    });
  }
});

test('exact ADMIN_EMAILS sender remains root staff without a profile', async () => {
  const db = senderResolutionDb();
  const { result, deliveries } = await routeWithResolvedSender({
    db,
    sender: 'Root Operator <ROOT@example.test>',
    suffix: 'root-operator',
    parent: parentFromBuyer(),
    env: { ADMIN_EMAILS: 'root@example.test, another@example.test' },
  });

  db.assertClean({ upserts: 1 });
  assert.equal(deliveries.length, 1);
  assert.equal(db.upsertCalls[0].p_sender_role, 'staff');
  assert.equal(db.upsertCalls[0].p_user_id, null);
  assert.deepEqual(result, { routed: true, duplicate: false });
});

test('ADMIN_EMAILS matching stays exact and unrelated senders remain rejected', async () => {
  const db = senderResolutionDb();
  const { result, deliveries } = await routeWithResolvedSender({
    db,
    sender: 'root+unlisted@example.test',
    suffix: 'unrelated-root-alias',
    parent: parentFromBuyer(),
    env: { ADMIN_EMAILS: 'root@example.test' },
  });

  db.assertClean({ upserts: 0 });
  assert.equal(deliveries.length, 0);
  assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
});

test('buyer replies still require the exact participant address and parent recipient', async (t) => {
  const address = 'buyer@example.test';

  await t.test('exact participant and recipient routes as buyer', async () => {
    const db = senderResolutionDb({
      buyerProfiles: [{ id: BUYER_ID }],
      emails: { [BUYER_ID]: address },
    });
    const { result, deliveries } = await routeWithResolvedSender({
      db,
      sender: address,
      suffix: 'buyer-exact',
      parent: parentFromStaff(),
    });

    db.assertClean({ upserts: 1 });
    assert.equal(deliveries.length, 1);
    assert.equal(db.upsertCalls[0].p_sender_role, 'buyer');
    assert.equal(db.upsertCalls[0].p_user_id, BUYER_ID);
    assert.deepEqual(result, { routed: true, duplicate: false });
  });

  await t.test('participant address cannot reply to a message for another recipient', async () => {
    const db = senderResolutionDb({
      buyerProfiles: [{ id: BUYER_ID }],
      emails: { [BUYER_ID]: address },
    });
    const { result, deliveries } = await routeWithResolvedSender({
      db,
      sender: address,
      suffix: 'buyer-wrong-recipient',
      parent: parentFromStaff({ recipient_user_id: OTHER_USER_ID }),
    });

    db.assertClean({ upserts: 0 });
    assert.equal(deliveries.length, 0);
    assert.deepEqual(result, { routed: false, reason: 'sender_not_recipient' });
  });

  await t.test('non-participant address is rejected', async () => {
    const db = senderResolutionDb({
      buyerProfiles: [{ id: BUYER_ID }],
      emails: { [BUYER_ID]: address },
    });
    const { result, deliveries } = await routeWithResolvedSender({
      db,
      sender: 'other-buyer@example.test',
      suffix: 'buyer-unrelated',
      parent: parentFromStaff(),
    });

    db.assertClean({ upserts: 0 });
    assert.equal(deliveries.length, 0);
    assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
  });
});

test('read-only platform staff retains an independently valid buyer reply path', async () => {
  const address = 'dual-buyer-staff@example.test';
  const db = senderResolutionDb({
    buyerProfiles: [{ id: BUYER_ID }],
    staffProfiles: [{ id: BUYER_ID, is_staff: true, staff_role: 'read_only' }],
    emails: { [BUYER_ID]: address },
  });
  const { result, deliveries } = await routeWithResolvedSender({
    db,
    sender: address,
    suffix: 'dual-buyer-staff',
    parent: parentFromStaff(),
  });

  db.assertClean({ upserts: 1 });
  assert.equal(deliveries.length, 1);
  assert.equal(db.upsertCalls[0].p_sender_role, 'buyer');
  assert.equal(db.upsertCalls[0].p_user_id, BUYER_ID);
  assert.deepEqual(result, { routed: true, duplicate: false });
});

test('read-only alert recipient receives configured alert but cannot author a reply', async () => {
  const address = 'read-only-alert@example.test';
  let alertRecipients;
  const alert = await deliverSupportMessageEmail({}, {}, {
    id: MESSAGE_ID,
    company_id: COMPANY_ID,
    company_name: 'Example Buyer',
    sender_role: 'buyer',
    user_id: BUYER_ID,
    body: 'Please review this request.',
  }, {
    adminRecipients: async () => [address],
    orderContext: async () => null,
    replyAddress: async () => `reply+${MESSAGE_ID}.0123456789abcdef0123@reply.masest.co`,
    threadParent: async () => null,
    sendEmail: async (_env, options) => {
      alertRecipients = options.to;
      return { ok: true, providerMessageId: '<read-only-alert@example.test>' };
    },
    saveDelivery: async () => {},
  });
  assert.equal(alert.ok, true);
  assert.deepEqual(alertRecipients, [address]);

  const db = senderResolutionDb({
    staffProfiles: [{ id: STAFF_ID, is_staff: true, staff_role: 'read_only' }],
    emails: { [STAFF_ID]: address },
  });
  const { result, deliveries } = await routeWithResolvedSender({
    db,
    sender: address,
    suffix: 'read-only-alert-reply',
    parent: parentFromBuyer(),
  });

  db.assertClean({ upserts: 0 });
  assert.equal(deliveries.length, 0);
  assert.deepEqual(result, { routed: false, reason: 'sender_not_participant' });
});
