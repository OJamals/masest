import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeSupportCursor,
  encodeSupportCursor,
  listSupportTickets,
  projectBuyerSupportTicket,
} from '../functions/_lib/support-tickets.js';
import { appendSupportMessage, messagePage } from '../functions/_lib/support-messages.js';
import { createAdminMessagesHandler } from '../functions/api/admin/messages.js';
import { createAccountMessagesHandler } from '../functions/api/account/messages.js';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY_THREAD_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_ID = '66666666-6666-4666-8666-666666666666';

function request(path, method = 'GET') {
  return new Request(`https://masest.test/api/${path}`, { method });
}

async function responseShape(response) {
  return { status: response.status, body: await response.json() };
}

test('support cursors round-trip exact PostgreSQL timestamp precision and reject another cursor kind', () => {
  const timestamp = '2026-09-06T14:00:00.123456+00:00';
  const cursor = encodeSupportCursor({ kind: 'ticket', timestamp, id: TICKET_ID });

  assert.deepEqual(decodeSupportCursor(cursor, { kind: 'ticket' }), {
    timestamp,
    id: TICKET_ID,
  });
  assert.equal(decodeSupportCursor(cursor, { kind: 'message' }), null);
});

test('support cursors reject malformed, oversized, invalid-date, and invalid-UUID payloads', () => {
  const encoded = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');

  assert.equal(decodeSupportCursor('not-json', { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor('x'.repeat(1025), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-99-99T99:99:99+00:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-09-06T14:00:00.123456+00:00',
    id: 'not-a-uuid',
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '0000-02-29T14:00:00.123456+00:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '0000-01-01T00:00:00+00:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-09-06T14:00:00.123456+16:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-09-06T14:00:00.123456+00:00',
    id: TICKET_ID,
    filter: 'raw PostgREST expression',
  }), { kind: 'ticket' }), null);
});

test('message pages use the last included composite row without losing microseconds', () => {
  const rows = [
    { id: '33333333-3333-4333-8333-333333333333', created_at: '2026-09-06T14:00:00.123457+00:00' },
    { id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-06T14:00:00.123456+00:00' },
    { id: TICKET_ID, created_at: '2026-09-06T14:00:00.123456+00:00' },
  ];

  const page = messagePage(rows, 2);

  assert.deepEqual(page.messages.map((message) => message.id), [rows[1].id, rows[0].id]);
  assert.equal(page.has_more, true);
  assert.deepEqual(decodeSupportCursor(page.next_message_cursor, { kind: 'message' }), {
    timestamp: rows[1].created_at,
    id: rows[1].id,
  });
});

test('buyer ticket projection excludes internal workflow priority and assignment', () => {
  const ticket = projectBuyerSupportTicket({
    id: TICKET_ID,
    ticket_number: 42,
    status: 'open',
    priority: 'urgent',
    assigned_to: '22222222-2222-4222-8222-222222222222',
    last_sender_role: 'buyer',
  });

  assert.equal(Object.hasOwn(ticket, 'priority'), false);
  assert.equal(Object.hasOwn(ticket, 'assigned_to'), false);
  assert.equal(ticket.needs_staff_reply, true);
});

test('ticket list RPC receives fail-closed buyer scope and returns an opaque last-row cursor', async () => {
  let call;
  const timestamp = '2026-09-06T14:00:00.123456+00:00';
  const sb = {
    async rpc(name, args) {
      call = { name, args };
      return {
        data: {
          tickets: [{
            id: TICKET_ID,
            ticket_number: 42,
            thread_id: '22222222-2222-4222-8222-222222222222',
            subject: 'Order question',
            status: 'resolved',
            priority: 'urgent',
            category: 'order',
            scope: 'company',
            last_message_at: timestamp,
          }],
          summary: { resolved: 1 },
          has_more: true,
          next_cursor: { timestamp, id: TICKET_ID },
        },
        error: null,
      };
    },
  };

  const result = await listSupportTickets(sb, {
    queue: 'all',
    threadIds: [],
    limit: 50,
    projection: 'buyer',
  });

  assert.equal(call.name, 'list_support_tickets');
  assert.deepEqual(call.args.p_thread_ids, []);
  assert.equal(call.args.p_queue, 'all');
  assert.equal(result.tickets[0].scope, 'company');
  assert.equal(Object.hasOwn(result.tickets[0], 'priority'), false);
  assert.deepEqual(decodeSupportCursor(result.next_cursor, { kind: 'ticket' }), {
    timestamp,
    id: TICKET_ID,
  });
});

test('staff append passes expected ticket version into the atomic SQL owner', async () => {
  let args;
  const sb = {
    async rpc(name, input) {
      assert.equal(name, 'append_support_message');
      args = input;
      return {
        data: {
          id: '22222222-2222-4222-8222-222222222222',
          ticket_id: TICKET_ID,
          ticket: { id: TICKET_ID, ticket_number: 42, status: 'open', priority: 'normal', version: 8 },
        },
        error: null,
      };
    },
  };

  await appendSupportMessage(sb, {
    companyId: null,
    recipientUserId: '33333333-3333-4333-8333-333333333333',
    senderRole: 'staff',
    body: 'Reply',
    ticketId: TICKET_ID,
    expectedTicketVersion: 7,
  });

  assert.equal(args.p_expected_ticket_version, 7);
});

test('admin queue validates and forwards bounded server filters while preserving page-independent summary', async () => {
  let listed;
  const handler = createAdminMessagesHandler({
    requireStaff: async () => ({ user: { id: STAFF_ID }, staff: true, role: 'owner' }),
    adminClient: () => ({}),
    listSupportTickets: async (_sb, input) => {
      listed = input;
      return {
        tickets: [{ id: TICKET_ID }],
        summary: { open: 9, unanswered: 4, needs_reply: 4, mine: 2, unassigned: 3, waiting: 1, resolved: 5 },
        has_more: false,
        next_cursor: null,
      };
    },
  });

  const response = await handler({
    request: request('admin/messages?queue=waiting&assignee=mine&priority=high&category=order&search=50%25_off&limit=25'),
    env: {},
  });

  assert.equal(response.status, 200);
  assert.equal(listed.queue, 'waiting');
  assert.equal(listed.assigneeMode, 'mine');
  assert.equal(listed.staffId, STAFF_ID);
  assert.equal(listed.limit, 25);
  assert.equal(listed.search, '50\\%\\_off');
  assert.equal((await response.json()).summary.open, 9);
});

test('admin assignee discovery is a separate response mode', async () => {
  const assignees = [{ id: STAFF_ID, name: 'Sam Support', role: 'support' }];
  const handler = createAdminMessagesHandler({
    requireStaff: async () => ({ user: { id: STAFF_ID }, staff: true, role: 'owner' }),
    adminClient: () => ({}),
    listSupportAssignees: async () => assignees,
  });

  const response = await handler({ request: request('admin/messages?view=assignees'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 200, body: { assignees } });
});

test('admin metadata mutation forwards exact ticket version and explicit unassignment', async () => {
  let mutation;
  const handler = createAdminMessagesHandler({
    requireStaff: async () => ({ user: { id: STAFF_ID }, staff: true, role: 'owner' }),
    adminClient: () => ({}),
    readBody: async () => ({ ticket_id: TICKET_ID, version: 7, category: 'billing', assigned_to: null }),
    updateSupportTicket: async (_sb, input) => {
      mutation = input;
      return { id: TICKET_ID, status: 'open', priority: 'normal', category: 'billing', version: 8 };
    },
  });

  const response = await handler({ request: request('admin/messages', 'PATCH'), env: {} });

  assert.equal(response.status, 200);
  assert.equal(mutation.ticketId, TICKET_ID);
  assert.equal(mutation.expectedVersion, 7);
  assert.equal(mutation.category, 'billing');
  assert.equal(mutation.assignmentProvided, true);
  assert.equal(mutation.assignedTo, null);
});

test('admin selected reply requires and forwards exact ticket version', async () => {
  let publication;
  const handler = createAdminMessagesHandler({
    requireStaff: async () => ({ user: { id: STAFF_ID }, staff: true, role: 'owner' }),
    adminClient: () => ({}),
    readBody: async () => ({ action: 'reply', ticket_id: TICKET_ID, version: 7, body: 'Exact reply' }),
    supportTicketById: async () => ({
      id: TICKET_ID, thread_id: THREAD_ID, subject: 'Order question', category: 'order',
      status: 'open', priority: 'normal', version: 7,
    }),
    loadThread: async () => ({
      id: THREAD_ID, participant_user_id: USER_ID, company_id: null, participant: { id: USER_ID }, scope: 'user',
    }),
    publishSupportMessage: async (_env, _sb, input) => {
      publication = input;
      return {
        message: {
          id: USER_ID,
          thread_id: THREAD_ID,
          ticket_id: TICKET_ID,
          created_at: '2026-09-06T14:00:00Z',
          ticket: { id: TICKET_ID, status: 'open', priority: 'normal', version: 8 },
        },
        emailDelivery: { state: 'queued' },
      };
    },
  });

  const response = await handler({ request: request('admin/messages', 'POST'), env: {} });

  assert.equal(response.status, 201);
  assert.equal(publication.ticketId, TICKET_ID);
  assert.equal(publication.expectedTicketVersion, 7);
  assert.equal(publication.startTicket, false);
});

test('buyer history uses queue all and preserves an empty fail-closed visible-thread array', async () => {
  let listed;
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
    visibleSupportThreadScope: async () => ({ participantThreadId: null, companyThreadId: null, threadIds: [] }),
    resolveSupportOrderId: async () => ({ ok: true, orderId: ORDER_ID }),
    listSupportTickets: async (_sb, input) => {
      listed = input;
      return { tickets: [], has_more: false, next_cursor: null };
    },
  });

  const response = await handler({
    request: request(`account/messages?view=tickets&order_id=${ORDER_ID}`),
    env: {},
  });

  assert.equal(response.status, 200);
  assert.equal(listed.queue, 'all');
  assert.deepEqual(listed.threadIds, []);
  assert.equal(listed.orderId, ORDER_ID);
  assert.deepEqual(await response.json(), { tickets: [], has_more: false, next_ticket_cursor: null });
});

test('buyer order-scoped history rejects a foreign order before listing tickets', async () => {
  let listed = false;
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
    visibleSupportThreadScope: async () => ({ participantThreadId: THREAD_ID, companyThreadId: null, threadIds: [THREAD_ID] }),
    resolveSupportOrderId: async () => ({ ok: false, status: 404, error: 'order_not_found' }),
    listSupportTickets: async () => { listed = true; },
  });

  const response = await handler({
    request: request(`account/messages?view=tickets&order_id=${ORDER_ID}`),
    env: {},
  });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'order_not_found' } });
  assert.equal(listed, false);
});

test('buyer company ticket scope survives history and exact detail projection', async () => {
  const companyTicket = {
    id: TICKET_ID,
    ticket_number: 42,
    thread_id: COMPANY_THREAD_ID,
    subject: 'Shared shipping issue',
    status: 'open',
    category: 'shipping',
    priority: 'urgent',
    assigned_to: STAFF_ID,
    last_sender_role: 'buyer',
    version: 7,
  };
  const scope = {
    participantThreadId: THREAD_ID,
    companyThreadId: COMPANY_THREAD_ID,
    threadIds: [THREAD_ID, COMPANY_THREAD_ID],
  };
  const history = createAccountMessagesHandler({
    requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
    visibleSupportThreadScope: async () => scope,
    listSupportTickets: async () => ({
      tickets: [projectBuyerSupportTicket({ ...companyTicket, scope: 'company' })],
      has_more: false,
      next_cursor: null,
    }),
  });
  const historyResponse = await history({ request: request('account/messages?view=tickets'), env: {} });
  assert.equal((await historyResponse.json()).tickets[0].scope, 'company');

  const emptyQuery = {
    select() { return this; },
    update() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  };
  const detail = createAccountMessagesHandler({
    requireCommerceUser: async () => ({
      user: { id: USER_ID }, companyId: '66666666-6666-4666-8666-666666666666',
      sb: { from: () => Object.create(emptyQuery) },
    }),
    visibleSupportThreadScope: async () => scope,
    supportTicketById: async () => companyTicket,
  });
  const detailResponse = await detail({
    request: request(`account/messages?ticket_id=${TICKET_ID}&peek=1`),
    env: {},
  });
  const detailBody = await detailResponse.json();
  assert.equal(detailBody.ticket.scope, 'company');
  assert.equal(Object.hasOwn(detailBody.ticket, 'priority'), false);
  assert.equal(detailBody.ticket.thread_id, COMPANY_THREAD_ID);
});

test('buyer exact Company reply keeps shared ticket identity and durable metadata', async () => {
  let publication;
  const companyTicket = {
    id: TICKET_ID,
    ticket_number: 42,
    thread_id: COMPANY_THREAD_ID,
    subject: 'Shared shipping issue',
    status: 'open',
    category: 'shipping',
    priority: 'urgent',
    assigned_to: STAFF_ID,
    version: 7,
  };
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({
      action: 'reply', ticket_id: TICKET_ID, body: 'Shared reply',
      subject: 'Attempted rename', category: 'billing',
    }),
    visibleSupportThreadScope: async () => ({
      participantThreadId: THREAD_ID,
      companyThreadId: COMPANY_THREAD_ID,
      threadIds: [THREAD_ID, COMPANY_THREAD_ID],
    }),
    supportTicketById: async () => companyTicket,
    publishSupportMessage: async (_env, _sb, input) => {
      publication = input;
      return {
        message: {
          id: USER_ID,
          thread_id: COMPANY_THREAD_ID,
          ticket_id: TICKET_ID,
          ticket: { ...companyTicket, version: 8 },
          created_at: '2026-09-06T14:00:00Z',
        },
        emailDelivery: { state: 'queued' },
      };
    },
  });

  const response = await handler({ request: request('account/messages', 'POST'), env: {} });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(publication.ticketId, TICKET_ID);
  assert.equal(publication.threadId, COMPANY_THREAD_ID);
  assert.equal(publication.subject, companyTicket.subject);
  assert.equal(publication.category, companyTicket.category);
  assert.equal(body.ticket.scope, 'company');
  assert.equal(body.ticket.thread_id, COMPANY_THREAD_ID);
  assert.equal(Object.hasOwn(body.ticket, 'priority'), false);
});

test('buyer new issue rejects a conflicting exact ticket before publication', async () => {
  let published = false;
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({ action: 'start_ticket', ticket_id: TICKET_ID, body: 'A new issue' }),
    publishSupportMessage: async () => { published = true; },
  });

  const response = await handler({ request: request('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 400, body: { error: 'invalid_ticket_action' } });
  assert.equal(published, false);
});
