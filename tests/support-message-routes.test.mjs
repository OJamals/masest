import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createAccountMessagesHandler } from '../functions/api/account/messages.js';
import { createAdminMessagesHandler } from '../functions/api/admin/messages.js';
import { encodeSupportCursor } from '../functions/_lib/support-tickets.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_COMPANY_ID = '55555555-5555-4555-8555-555555555555';
const USER_THREAD_ID = '66666666-6666-4666-8666-666666666666';
const COMPANY_THREAD_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '88888888-8888-4888-8888-888888888888';
const TICKET_ID = '99999999-9999-4999-8999-999999999999';
const MESSAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-09-06T14:15:16.123456+00:00';
const businessSource = readFileSync(new URL('../js/business.js', import.meta.url), 'utf8');

function routeRequest(path = '', method = 'GET') {
  return new Request(`https://masest.test/api/${path}`, { method });
}

async function responseShape(response) {
  return { status: response.status, body: await response.json() };
}

function supportTicket(overrides = {}) {
  return {
    id: TICKET_ID,
    ticket_number: 123,
    thread_id: USER_THREAD_ID,
    subject: 'Pump-room scaling',
    status: 'open',
    priority: 'normal',
    category: 'technical',
    assigned_to: null,
    primary_order_id: null,
    first_response_at: null,
    resolved_at: null,
    last_message_at: NOW,
    last_message_body: 'Need help',
    last_sender_role: 'buyer',
    created_at: '2026-09-06T14:00:00.000000+00:00',
    updated_at: NOW,
    version: 7,
    ...overrides,
  };
}

function supportThread(overrides = {}) {
  return {
    id: USER_THREAD_ID,
    participant_user_id: USER_ID,
    company_id: COMPANY_ID,
    participant: { id: USER_ID, full_name: 'Buyer' },
    company: { id: COMPANY_ID, name: 'Proof Co' },
    ...overrides,
  };
}

function orderRow(overrides = {}) {
  return {
    id: ORDER_ID,
    order_number: 'MST-1042',
    status: 'paid',
    company_id: COMPANY_ID,
    user_id: USER_ID,
    customer_email: 'buyer@example.test',
    ...overrides,
  };
}

function fakeDb(sequence = {}) {
  const calls = [];
  const indexes = new Map();
  const builders = ['select', 'eq', 'or', 'is', 'in', 'order', 'limit', 'update', 'not', 'neq', 'insert'];
  const settle = async (table, operations, terminal) => {
    const call = { table, operations: operations.map((entry) => [...entry]), terminal };
    calls.push(call);
    const index = indexes.get(table) || 0;
    indexes.set(table, index + 1);
    const source = sequence[table];
    if (typeof source === 'function') return source(call, index);
    if (Array.isArray(source)) return source[index] || { data: [], error: null };
    return source || { data: [], error: null };
  };
  return {
    calls,
    from(table) {
      const operations = [];
      const chain = {
        maybeSingle: () => settle(table, operations, 'maybeSingle'),
        then: (resolve, reject) => settle(table, operations, 'then').then(resolve, reject),
      };
      for (const name of builders) {
        chain[name] = (...args) => { operations.push([name, ...args]); return chain; };
      }
      return chain;
    },
  };
}

function buyerHandler({
  sb = fakeDb(), context, body = {}, rate = { ok: true }, ticket = supportTicket(),
  scope = { participantThreadId: USER_THREAD_ID, companyThreadId: COMPANY_THREAD_ID, threadIds: [USER_THREAD_ID, COMPANY_THREAD_ID] },
  listResult = { tickets: [supportTicket()], summary: {}, has_more: false, next_cursor: null },
  activity = [], publisher,
} = {}) {
  const calls = { body: 0, rate: 0, publish: [], list: [], scope: 0, ticket: 0, activity: 0 };
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => context || {
      user: { id: USER_ID, email: 'buyer@example.test' }, companyId: COMPANY_ID, sb,
    },
    readBody: async () => { calls.body += 1; return body; },
    rateLimit: async () => { calls.rate += 1; return rate; },
    visibleSupportThreadScope: async () => { calls.scope += 1; return scope; },
    listSupportTickets: async (_sb, input) => { calls.list.push(input); return listResult; },
    supportTicketById: async () => { calls.ticket += 1; return ticket; },
    buyerActivity: async () => { calls.activity += 1; return activity; },
    publishSupportMessage: async (...args) => {
      calls.publish.push(args);
      if (publisher) return publisher(...args);
      return {
        message: {
          id: MESSAGE_ID,
          thread_id: ticket?.thread_id || USER_THREAD_ID,
          ticket_id: ticket?.id || TICKET_ID,
          ticket,
          created_at: NOW,
          order_id: null,
        },
        emailDelivery: { state: 'queued' },
      };
    },
  });
  return { handler, calls, sb };
}

function adminHandler({
  sb = fakeDb(), context = { user: { id: STAFF_ID }, staff: true, role: 'support' },
  body = {}, ticket = supportTicket(), thread = supportThread(), listResult,
  assignees = [], recipient = { id: USER_ID, company_id: COMPANY_ID, full_name: 'Buyer' },
  patcher, publisher,
} = {}) {
  const calls = { body: 0, client: 0, list: [], assignees: 0, ticket: 0, thread: 0, recipient: 0, patch: [], publish: [] };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => context,
    adminClient: () => { calls.client += 1; return sb; },
    readBody: async () => { calls.body += 1; return body; },
    listSupportTickets: async (_sb, input) => {
      calls.list.push(input);
      return listResult || {
        tickets: [ticket],
        summary: { open: 1, unanswered: 1, needs_reply: 1, mine: 0, unassigned: 1, waiting: 0, resolved: 0 },
        has_more: false,
        next_cursor: null,
      };
    },
    listSupportAssignees: async () => { calls.assignees += 1; return assignees; },
    supportTicketById: async () => { calls.ticket += 1; return ticket; },
    loadThread: async () => { calls.thread += 1; return thread; },
    resolveSupportRecipient: async () => { calls.recipient += 1; return recipient; },
    updateSupportTicket: async (_sb, input) => {
      calls.patch.push(input);
      if (patcher) return patcher(input);
      return { ...ticket, ...input, id: input.ticketId, version: input.expectedVersion + 1 };
    },
    publishSupportMessage: async (...args) => {
      calls.publish.push(args);
      if (publisher) return publisher(...args);
      return {
        message: {
          id: MESSAGE_ID,
          thread_id: thread?.id || USER_THREAD_ID,
          ticket_id: ticket?.id || TICKET_ID,
          ticket,
          recipient_user_id: USER_ID,
          created_at: NOW,
          order_id: null,
        },
        emailDelivery: { state: 'queued' },
      };
    },
  });
  return { handler, calls, sb };
}

test('buyer with no visible participant thread receives an empty active inbox without creating a ticket', async () => {
  const { handler, calls } = buyerHandler({
    scope: { participantThreadId: null, companyThreadId: null, threadIds: [] },
  });
  const response = await handler({ request: routeRequest('account/messages'), env: {} });
  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: { ticket: null, messages: [], has_more: false, next_message_cursor: null, order_scope: null },
  });
  assert.equal(calls.list.length, 0);
  assert.equal(calls.publish.length, 0);
});

test('buyer authentication and context errors pass through without database or publication I/O', async (t) => {
  for (const [name, status] of [['unauthenticated', 401], ['context unavailable', 503]]) {
    await t.test(name, async () => {
      const { handler, calls } = buyerHandler({ context: { error: new Response('{}', { status }) } });
      const response = await handler({ request: routeRequest('account/messages'), env: {} });
      assert.equal(response.status, status);
      assert.equal(calls.scope, 0);
      assert.equal(calls.publish.length, 0);
    });
  }
});

test('buyer active selection is personal, order-constrained, read-only until exact transcript marking', async () => {
  const sb = fakeDb({
    messages: [
      { data: [{ id: MESSAGE_ID, ticket_id: TICKET_ID, sender_role: 'staff', body: 'Reply', order_id: null, created_at: NOW }], error: null },
      { data: null, error: null },
    ],
  });
  const active = supportTicket();
  const { handler, calls } = buyerHandler({ sb, listResult: { tickets: [active], has_more: false, next_cursor: null } });
  const response = await handler({ request: routeRequest(`account/messages?order_id=${ORDER_ID}`), env: {} });
  // The real order resolver runs before the read-only active selector.
  assert.equal(response.status, 404, 'a missing owned order must fail before active selection');
  assert.equal(calls.list.length, 0);
});

test('buyer default GET asks the SQL owner for one active personal ticket only', async () => {
  const sb = fakeDb({ messages: [{ data: [], error: null }, { data: null, error: null }] });
  const { handler, calls } = buyerHandler({ sb });
  const response = await handler({ request: routeRequest('account/messages'), env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.list[0], {
    queue: 'active', threadIds: [USER_THREAD_ID], orderId: null, limit: 1, projection: 'buyer',
  });
  const read = sb.calls.find((call) => call.operations.some(([name]) => name === 'select'));
  assert.ok(read.operations.some(([name, field, value]) => name === 'eq' && field === 'ticket_id' && value === TICKET_ID));
});

test('buyer history is paginated across personal and Company scope with no unrestricted null', async () => {
  const { handler, calls } = buyerHandler({
    listResult: { tickets: [], has_more: true, next_cursor: 'opaque' },
  });
  const response = await handler({ request: routeRequest('account/messages?view=tickets&limit=20'), env: {} });
  assert.equal(response.status, 200);
  assert.equal(calls.list[0].queue, 'all');
  assert.deepEqual(calls.list[0].threadIds, [USER_THREAD_ID, COMPANY_THREAD_ID]);
  assert.equal((await response.json()).next_ticket_cursor, 'opaque');
});

test('buyer activity is bounded peek-only and never writes read receipts', async () => {
  const message = { id: MESSAGE_ID, ticket: { id: TICKET_ID }, body: 'Preview' };
  const { handler, calls, sb } = buyerHandler({ activity: [message] });
  assert.equal((await handler({ request: routeRequest('account/messages?view=activity'), env: {} })).status, 400);
  const response = await handler({ request: routeRequest('account/messages?view=activity&peek=1'), env: {} });
  assert.deepEqual(await responseShape(response), { status: 200, body: { messages: [message] } });
  assert.equal(calls.activity, 1);
  assert.equal(sb.calls.length, 0);
});

test('buyer exact ticket detail marks only that ticket and preserves a Company scope label', async () => {
  const companyTicket = supportTicket({ thread_id: COMPANY_THREAD_ID });
  const sb = fakeDb({
    messages: [
      { data: [{ id: MESSAGE_ID, ticket_id: TICKET_ID, sender_role: 'staff', body: 'Shared reply', order_id: null, created_at: NOW }], error: null },
      { data: null, error: null },
    ],
  });
  const { handler } = buyerHandler({ sb, ticket: companyTicket });
  const response = await handler({ request: routeRequest(`account/messages?ticket_id=${TICKET_ID}`), env: {} });
  const body = await response.json();
  assert.equal(body.ticket.scope, 'company');
  assert.equal(Object.hasOwn(body.ticket, 'priority'), false);
  const update = sb.calls.find((call) => call.operations.some(([name]) => name === 'update'));
  assert.ok(update.operations.some(([name, field, value]) => name === 'eq' && field === 'ticket_id' && value === TICKET_ID));
  assert.ok(update.operations.some(([name, field, value]) => name === 'eq' && field === 'sender_role' && value === 'staff'));
});

test('buyer exact peek uses a composite message cursor and does not mark reads', async () => {
  const cursor = encodeSupportCursor({ kind: 'message', timestamp: NOW, id: MESSAGE_ID });
  const sb = fakeDb({ messages: { data: [], error: null } });
  const { handler } = buyerHandler({ sb });
  const response = await handler({
    request: routeRequest(`account/messages?ticket_id=${TICKET_ID}&message_cursor=${cursor}&peek=1&limit=25`), env: {},
  });
  assert.equal(response.status, 200);
  assert.equal(sb.calls.length, 1);
  const query = sb.calls[0];
  assert.ok(query.operations.some(([name, field]) => name === 'order' && field === 'created_at'));
  assert.ok(query.operations.some(([name, field]) => name === 'order' && field === 'id'));
  assert.ok(query.operations.some(([name, value]) => name === 'or' && value.includes(MESSAGE_ID)));
});

test('buyer exact detail fails closed for foreign ticket membership', async () => {
  const { handler } = buyerHandler({ ticket: supportTicket({ thread_id: OTHER_COMPANY_ID }) });
  assert.deepEqual(await responseShape(await handler({
    request: routeRequest(`account/messages?ticket_id=${TICKET_ID}`), env: {},
  })), { status: 404, body: { error: 'ticket_not_found' } });
});

test('buyer rejects foreign and absent order scope before active read or publication', async (t) => {
  for (const [name, row] of [
    ['foreign', orderRow({ company_id: OTHER_COMPANY_ID, user_id: OTHER_USER_ID })],
    ['absent', null],
  ]) {
    await t.test(name, async () => {
      const sb = fakeDb({ orders: { data: row, error: null } });
      const { handler, calls } = buyerHandler({ sb, body: { body: 'Question', order_id: ORDER_ID } });
      const get = await handler({ request: routeRequest(`account/messages?order_id=${ORDER_ID}`), env: {} });
      assert.equal(get.status, 404);
      const post = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });
      assert.equal(post.status, 404);
      assert.equal(calls.publish.length, 0);
    });
  }
});

test('buyer presence validates boolean and updates only the authenticated profile', async () => {
  const invalid = buyerHandler({ body: { action: 'chat_presence', chat_open: 'yes' } });
  assert.equal((await invalid.handler({ request: routeRequest('account/messages', 'POST'), env: {} })).status, 400);
  const sb = fakeDb({ profiles: { data: null, error: null } });
  const valid = buyerHandler({ sb, body: { action: 'chat_presence', chat_open: true } });
  const response = await valid.handler({ request: routeRequest('account/messages', 'POST'), env: {} });
  assert.equal(response.status, 200);
  assert.equal(valid.calls.rate, 0);
  assert.ok(sb.calls[0].operations.some(([name, field, value]) => name === 'eq' && field === 'id' && value === USER_ID));
});

test('buyer message boundaries reject rate limit, empty, and oversized input before publication', async (t) => {
  const cases = [
    ['rate limit', { body: { body: 'Hello' }, rate: { ok: false, retryAfter: 17 }, status: 429 }],
    ['empty', { body: { body: ' ' }, status: 400 }],
    ['oversized', { body: { body: 'x'.repeat(4001) }, status: 400 }],
  ];
  for (const [name, setup] of cases) {
    await t.test(name, async () => {
      const { handler, calls } = buyerHandler(setup);
      assert.equal((await handler({ request: routeRequest('account/messages', 'POST'), env: {} })).status, setup.status);
      assert.equal(calls.publish.length, 0);
    });
  }
});

test('companyless buyer default publication retains automatic personal routing', async () => {
  const { handler, calls } = buyerHandler({
    context: { user: { id: USER_ID }, companyId: null, sb: fakeDb() },
    body: { body: 'Retail question', source: 'customer_chat' },
    ticket: null,
  });
  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });
  assert.equal(response.status, 201);
  const input = calls.publish[0][2];
  assert.equal(input.companyId, null);
  assert.equal(input.threadUserId, USER_ID);
  assert.equal(input.ticketId, null);
  assert.equal(input.startTicket, false);
});

test('program and bulk intake retain deliberate automatic-active support routing', () => {
  const compatibilityCalls = businessSource
    .split("await api('/api/account/messages'")
    .slice(1)
    .map((source) => source.slice(0, 420));
  assert.equal(compatibilityCalls.length, 2);
  assert.match(compatibilityCalls[0], /Program request/);
  assert.match(compatibilityCalls[1], /Bulk \/ standing order request/);
  for (const call of compatibilityCalls) {
    assert.doesNotMatch(call, /ticket_id|thread_id|start_ticket|action\s*:/);
  }
});

test('buyer exact Company reply keeps shared identity and cannot edit subject/category', async () => {
  const ticket = supportTicket({ thread_id: COMPANY_THREAD_ID, subject: 'Durable subject', category: 'shipping' });
  const { handler, calls } = buyerHandler({
    ticket,
    body: { action: 'reply', ticket_id: TICKET_ID, body: 'Shared response', subject: 'Spoof', category: 'billing' },
  });
  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });
  const body = await response.json();
  const input = calls.publish[0][2];
  assert.equal(input.threadId, COMPANY_THREAD_ID);
  assert.equal(input.ticketId, TICKET_ID);
  assert.equal(input.subject, 'Durable subject');
  assert.equal(input.category, 'shipping');
  assert.equal(body.ticket.scope, 'company');
});

test('buyer exact reply rejects a foreign ticket before publication', async () => {
  const { handler, calls } = buyerHandler({
    ticket: supportTicket({ thread_id: OTHER_COMPANY_ID }),
    body: { action: 'reply', ticket_id: TICKET_ID, body: 'Foreign reply attempt' },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'ticket_not_found' } });
  assert.equal(calls.publish.length, 0);
});

test('buyer deliberate new issue has no conflicting ticket identity', async () => {
  const { handler, calls } = buyerHandler({
    body: { action: 'start_ticket', body: 'New issue body', subject: 'New issue', category: 'order' },
    ticket: null,
  });
  assert.equal((await handler({ request: routeRequest('account/messages', 'POST'), env: {} })).status, 201);
  assert.equal(calls.publish[0][2].ticketId, null);
  assert.equal(calls.publish[0][2].startTicket, true);
  const conflict = buyerHandler({ body: { action: 'start_ticket', body: 'New', ticket_id: TICKET_ID } });
  assert.equal((await conflict.handler({ request: routeRequest('account/messages', 'POST'), env: {} })).status, 400);
  assert.equal(conflict.calls.publish.length, 0);
});

test('buyer explicit new issue preserves the routing activation fence', async () => {
  const { handler, calls } = buyerHandler({
    body: { action: 'start_ticket', body: 'New issue body', subject: 'New issue', category: 'general' },
    ticket: null,
    publisher: async () => { throw new Error('support_ticket_routing_not_enabled'); },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 409, body: { error: 'support_ticket_routing_not_enabled' } });
  assert.equal(calls.publish.length, 1);
});

test('buyer retryable email delivery retains the canonical persisted message', async () => {
  const { handler } = buyerHandler({
    body: { body: 'Keep this message' },
    publisher: async () => ({
      message: { id: MESSAGE_ID, thread_id: USER_THREAD_ID, ticket_id: TICKET_ID, ticket: supportTicket(), created_at: NOW },
      emailDelivery: { state: 'queued', reason: 'support_email_delivery_failed' },
    }),
  });
  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.id, MESSAGE_ID);
  assert.equal(result.ticket_id, TICKET_ID);
  assert.equal(result.ticket.priority, undefined);
  assert.deepEqual(result.email_delivery, { state: 'queued', reason: 'support_email_delivery_failed' });
});

test('buyer masks database and publication errors', async (t) => {
  await t.test('database', async () => {
    const { handler } = buyerHandler({
      scope: null,
    });
    // A dependency failure is intentionally exposed only as server_error.
    const failing = createAccountMessagesHandler({
      requireCommerceUser: async () => ({ user: { id: USER_ID }, companyId: null, sb: {} }),
      visibleSupportThreadScope: async () => { throw new Error('secret db error'); },
    });
    assert.deepEqual(await responseShape(await failing({ request: routeRequest('account/messages'), env: {} })),
      { status: 500, body: { error: 'server_error' } });
    void handler;
  });
  await t.test('publication', async () => {
    const { handler } = buyerHandler({ body: { body: 'Hello' }, publisher: async () => { throw new Error('secret'); } });
    assert.deepEqual(await responseShape(await handler({ request: routeRequest('account/messages', 'POST'), env: {} })),
      { status: 500, body: { error: 'server_error' } });
  });
});

test('staff authentication rejects unauthenticated and non-staff callers before admin I/O', async (t) => {
  for (const [name, context, status] of [
    ['unauthenticated', { user: null, staff: false, role: null }, 401],
    ['non-staff', { user: { id: USER_ID }, staff: false, role: null }, 403],
  ]) {
    await t.test(name, async () => {
      const { handler, calls } = adminHandler({ context });
      assert.equal((await handler({ request: routeRequest('admin/messages'), env: {} })).status, status);
      assert.equal(calls.client, 0);
    });
  }
});

test('read-only staff can list but cannot parse or execute mutations', async () => {
  const { handler, calls } = adminHandler({ context: { user: { id: STAFF_ID }, staff: true, role: 'read_only' } });
  assert.equal((await handler({ request: routeRequest('admin/messages'), env: {} })).status, 200);
  assert.equal((await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} })).status, 403);
  assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 403);
  assert.equal(calls.body, 0);
});

test('staff queue and summary delegate bounded filters and page-independent counts', async () => {
  const page = {
    tickets: [supportTicket()],
    summary: { open: 9, unanswered: 4, needs_reply: 4, mine: 2, unassigned: 3, waiting: 1, resolved: 5 },
    has_more: true,
    next_cursor: 'next',
  };
  const { handler, calls } = adminHandler({ listResult: page });
  const response = await handler({
    request: routeRequest('admin/messages?queue=waiting&assignee=mine&priority=high&category=order&search=50%25_off&limit=25'), env: {},
  });
  assert.deepEqual(await responseShape(response), { status: 200, body: page });
  assert.equal(calls.list[0].search, '50\\%\\_off');
  assert.equal(calls.list[0].staffId, STAFF_ID);
  const summary = await handler({ request: routeRequest('admin/messages?summary=1'), env: {} });
  assert.deepEqual(await responseShape(summary), { status: 200, body: { summary: page.summary } });
});

test('staff queue rejects invalid enums, overlong search, caps, and foreign cursor kinds', async (t) => {
  const cursor = encodeSupportCursor({ kind: 'message', timestamp: NOW, id: MESSAGE_ID });
  for (const path of [
    'admin/messages?queue=bogus',
    'admin/messages?priority=low',
    'admin/messages?category=other',
    `admin/messages?search=${'x'.repeat(121)}`,
    'admin/messages?limit=101',
    `admin/messages?cursor=${cursor}`,
  ]) {
    await t.test(path, async () => {
      const { handler, calls } = adminHandler();
      assert.equal((await handler({ request: routeRequest(path), env: {} })).status, 400);
      assert.equal(calls.list.length, 0);
    });
  }
});

test('staff assignee discovery is isolated and bounded by its domain owner', async () => {
  const assignees = [{ id: STAFF_ID, name: 'Sam Support', role: 'support' }];
  const { handler, calls } = adminHandler({ assignees });
  assert.deepEqual(await responseShape(await handler({ request: routeRequest('admin/messages?view=assignees'), env: {} })),
    { status: 200, body: { assignees } });
  assert.equal(calls.assignees, 1);
  assert.equal(calls.list.length, 0);
});

test('staff exact detail reads and marks only the selected ticket', async () => {
  const sb = fakeDb({
    messages: [
      { data: [{ id: MESSAGE_ID, ticket_id: TICKET_ID, sender_role: 'buyer', body: 'Question', order_id: null, created_at: NOW }], error: null },
      { data: null, error: null },
    ],
  });
  const { handler } = adminHandler({ sb });
  const response = await handler({ request: routeRequest(`admin/messages?ticket_id=${TICKET_ID}`), env: {} });
  const body = await response.json();
  assert.equal(body.ticket.id, TICKET_ID);
  assert.equal(body.thread.thread_id, USER_THREAD_ID);
  assert.equal(body.messages[0].id, MESSAGE_ID);
  for (const call of sb.calls) {
    assert.ok(call.operations.some(([name, field, value]) => name === 'eq' && field === 'ticket_id' && value === TICKET_ID));
  }
  const update = sb.calls.find((call) => call.operations.some(([name]) => name === 'update'));
  assert.ok(update.operations.some(([name, field, value]) => name === 'eq' && field === 'sender_role' && value === 'buyer'));
});

test('staff exact detail validates order context but keeps the complete ticket transcript', async () => {
  const sb = fakeDb({
    orders: { data: orderRow(), error: null },
    messages: { data: [{ id: MESSAGE_ID, ticket_id: TICKET_ID, sender_role: 'buyer', body: 'Earlier context', order_id: null, created_at: NOW }], error: null },
  });
  const { handler } = adminHandler({ sb });
  const response = await handler({
    request: routeRequest(`admin/messages?ticket_id=${TICKET_ID}&order_id=${ORDER_ID}&peek=1`), env: {},
  });
  const body = await response.json();
  assert.equal(body.order_scope.id, ORDER_ID);
  const messages = sb.calls.find((call) => call.table === 'messages');
  assert.equal(messages.operations.some(([name, field]) => name === 'eq' && field === 'order_id'), false);
});

test('staff PATCH validates exact ticket/version/enums before atomic mutation', async (t) => {
  const invalidBodies = [
    {},
    { ticket_id: TICKET_ID, status: 'open' },
    { ticket_id: TICKET_ID, version: 7, status: 'complete' },
    { ticket_id: TICKET_ID, version: 7, priority: 'low' },
    { ticket_id: TICKET_ID, version: 7, category: 'other' },
    { ticket_id: TICKET_ID, version: 7, assigned_to: 'not-a-uuid' },
  ];
  for (const body of invalidBodies) {
    await t.test(JSON.stringify(body), async () => {
      const { handler, calls } = adminHandler({ body });
      assert.equal((await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} })).status, 400);
      assert.equal(calls.patch.length, 0);
    });
  }
});

test('staff PATCH forwards category and explicit null assignment under one CAS', async () => {
  const { handler, calls } = adminHandler({
    body: { ticket_id: TICKET_ID, version: 7, status: 'waiting_on_customer', priority: 'urgent', category: 'billing', assigned_to: null },
  });
  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.patch[0], {
    ticketId: TICKET_ID, expectedVersion: 7, actorId: STAFF_ID,
    status: 'waiting_on_customer', priority: 'urgent', category: 'billing',
    assignedTo: null, assignmentProvided: true,
  });
});

test('staff PATCH maps stale, missing, ineligible, and internal failures without leaking details', async (t) => {
  const cases = [
    ['stale', new Error('ticket_version_conflict'), 409, 'ticket_version_conflict'],
    ['missing', new Error('support_ticket_not_found'), 404, 'ticket_not_found'],
    ['ineligible', new Error('support_ticket_assignee_ineligible'), 400, 'invalid_assignee'],
    ['internal', new Error('secret database detail'), 500, 'server_error'],
  ];
  for (const [name, error, status, code] of cases) {
    await t.test(name, async () => {
      const { handler } = adminHandler({
        body: { ticket_id: TICKET_ID, version: 7, status: 'open' },
        patcher: async () => { throw error; },
      });
      assert.deepEqual(await responseShape(await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} })),
        { status, body: { error: code } });
    });
  }
});

test('staff PATCH maps a paused support fence to a retryable response', async (t) => {
  for (const [name, pausedError] of [
    ['message', new Error('support_writes_paused')],
    ['code', Object.assign(new Error('database rejected write'), { code: 'support_writes_paused' })],
  ]) {
    await t.test(name, async () => {
      const { handler } = adminHandler({
        body: { ticket_id: TICKET_ID, version: 7, priority: 'urgent' },
        patcher: async () => { throw pausedError; },
      });
      const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.deepEqual(await response.json(), { error: 'support_writes_paused', retryable: true });
    });
  }
});

test('staff new ticket requires a recipient and delegates fresh episode creation without legacy hints', async () => {
  const missing = adminHandler({ body: { action: 'start_ticket', body: 'New issue' } });
  assert.equal((await missing.handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 400);

  const { handler, calls } = adminHandler({
    body: { action: 'start_ticket', recipient_user_id: USER_ID, subject: 'New order issue', category: 'order', body: 'Please review' },
  });
  assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 201);
  const input = calls.publish[0][2];
  assert.equal(input.ticketId, null);
  assert.equal(input.threadId, null);
  assert.equal(input.startTicket, true);
  assert.equal(input.expectedTicketVersion, null);
});

test('staff new-ticket boundary rejects existing ticket/thread lifecycle hints', async () => {
  for (const body of [
    { action: 'start_ticket', body: 'New', recipient_user_id: USER_ID, ticket_id: TICKET_ID },
    { action: 'start_ticket', body: 'New', recipient_user_id: USER_ID, thread_id: USER_THREAD_ID },
    { action: 'start_ticket', body: 'New', recipient_user_id: USER_ID, start_thread: true },
  ]) {
    const { handler, calls } = adminHandler({ body });
    assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 400);
    assert.equal(calls.publish.length, 0);
  }
});

test('staff exact reply keeps ticket metadata and ignores forged thread/recipient identity', async () => {
  const ticket = supportTicket({ subject: 'Durable subject', category: 'technical' });
  const { handler, calls } = adminHandler({
    ticket,
    body: {
      action: 'reply', ticket_id: TICKET_ID, version: 7, body: 'Exact reply',
      subject: 'Spoof', category: 'billing', thread_id: COMPANY_THREAD_ID,
      recipient_user_id: OTHER_USER_ID,
    },
  });
  assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 201);
  const input = calls.publish[0][2];
  assert.equal(input.ticketId, TICKET_ID);
  assert.equal(input.threadId, USER_THREAD_ID);
  assert.equal(input.recipientUserId, USER_ID);
  assert.equal(input.expectedTicketVersion, 7);
  assert.equal(input.subject, 'Durable subject');
  assert.equal(input.category, 'technical');
});

test('staff reply requires exact ticket and version before publication', async () => {
  for (const body of [
    { action: 'reply', version: 7, body: 'Missing ticket' },
    { action: 'reply', ticket_id: TICKET_ID, body: 'Missing version' },
    { action: 'reply', ticket_id: 'bad', version: 7, body: 'Bad ticket' },
  ]) {
    const { handler, calls } = adminHandler({ body });
    assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 400);
    assert.equal(calls.publish.length, 0);
  }
});

test('staff reply maps routing, stale, resolved, and internal publication errors', async (t) => {
  const cases = [
    ['routing', new Error('support_ticket_routing_not_enabled'), 409, 'support_ticket_routing_not_enabled'],
    ['stale', new Error('ticket_version_conflict'), 409, 'ticket_version_conflict'],
    ['resolved', new Error('support_ticket_reply_resolved'), 409, 'ticket_resolved'],
    ['internal', new Error('provider secret'), 500, 'server_error'],
  ];
  for (const [name, error, status, code] of cases) {
    await t.test(name, async () => {
      const { handler } = adminHandler({
        body: { action: 'reply', ticket_id: TICKET_ID, version: 7, body: 'Reply' },
        publisher: async () => { throw error; },
      });
      assert.deepEqual(await responseShape(await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })),
        { status, body: { error: code } });
    });
  }
});

test('staff reply rejects foreign order before publication', async () => {
  const sb = fakeDb({ orders: { data: orderRow({ company_id: OTHER_COMPANY_ID, user_id: OTHER_USER_ID }), error: null } });
  const { handler, calls } = adminHandler({
    sb,
    body: { action: 'reply', ticket_id: TICKET_ID, version: 7, body: 'Reply', order_id: ORDER_ID },
  });
  assert.equal((await handler({ request: routeRequest('admin/messages', 'POST'), env: {} })).status, 404);
  assert.equal(calls.publish.length, 0);
});
