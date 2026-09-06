import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { createAccountMessagesHandler } from '../functions/api/account/messages.js';
import { createAdminMessagesHandler } from '../functions/api/admin/messages.js';
import { appendSupportMessage } from '../functions/_lib/support-messages.js';
import { publishSupportMessage } from '../functions/_lib/support-message-publisher.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_COMPANY_ID = '55555555-5555-4555-8555-555555555555';
const USER_THREAD_ID = '66666666-6666-4666-8666-666666666666';
const COMPANY_THREAD_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '88888888-8888-4888-8888-888888888888';
const TICKET_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_TICKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-09-06T14:15:16.000Z';

const THREAD_SELECT = 'id,participant_user_id,company_id,last_message_at,last_message_body,last_sender_role,last_order_id';
const BUYER_MESSAGE_SELECT = 'id,thread_id,ticket_id,sender_role,body,order_id,source,created_at';
const STAFF_MESSAGE_SELECT = 'id,thread_id,ticket_id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references';
const ORDER_SELECT = 'id,order_number,status,company_id,user_id,customer_email';
const ORDER_CONTEXT_SELECT = 'id,order_number,status,company_id';
const PROFILE_SELECT = 'id,full_name,company_id';
const RECIPIENT_SELECT = 'id,company_id,full_name,notify_messages,support_chat_open,support_chat_seen_at';
const COMPANY_SELECT = 'id,name,status';
const SUPPORT_TICKET_SELECT = 'id,ticket_number,thread_id,subject,status,priority,category,assigned_to,primary_order_id,first_response_at,resolved_at,last_message_at,last_message_body,last_sender_role,created_at,updated_at,version';

function op(method, ...args) {
  return { method, args };
}

function query(table, ops, result) {
  return { kind: 'query', table, ops, terminal: 'then', result };
}

function single(table, ops, result) {
  return { kind: 'query', table, ops, terminal: 'maybeSingle', result };
}

function sameOperations(expected, actual) {
  if (expected.length !== actual.length) return false;
  const filters = new Set(['eq', 'or', 'is', 'in', 'lt', 'not', 'neq']);
  const expectedStructure = expected.filter((operation) => !filters.has(operation.method));
  const actualStructure = actual.filter((operation) => !filters.has(operation.method));
  if (!isDeepStrictEqual(expectedStructure, actualStructure)) return false;
  const unmatched = actual.filter((operation) => filters.has(operation.method));
  for (const operation of expected.filter((entry) => filters.has(entry.method))) {
    const index = unmatched.findIndex((candidate) => isDeepStrictEqual(candidate, operation));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

function strictSupabase(expectations = [], { authUsers = [] } = {}) {
  const pending = expectations.map((expectation) => ({ ...expectation }));
  const pendingAuthUsers = authUsers.map((expectation) => ({ ...expectation }));
  const calls = [];
  const authCalls = [];
  const violations = [];
  const builders = ['select', 'eq', 'or', 'is', 'in', 'order', 'limit', 'lt', 'update', 'not', 'neq', 'insert'];

  function settle(table, ops, terminal) {
    const call = { kind: 'query', table, ops: ops.map((entry) => ({ ...entry })), terminal };
    calls.push(call);
    const index = pending.findIndex((expected) => (
      expected.kind === 'query'
      && expected.table === table
      && expected.terminal === terminal
      && sameOperations(expected.ops, ops)
    ));
    if (index === -1) {
      violations.push(`unexpected query ${JSON.stringify(call)}`);
      return Promise.resolve({ data: null, error: new Error('unexpected fake query') });
    }
    const [expected] = pending.splice(index, 1);
    try {
      if (expected.onSettle) expected.onSettle(call);
    } catch (error) {
      violations.push(`query sequencing assertion failed: ${error.message}`);
      return Promise.reject(error);
    }
    if (expected.reject) return Promise.reject(expected.reject);
    return Promise.resolve(expected.result);
  }

  function chain(table) {
    const ops = [];
    let proxy;
    const target = {
      maybeSingle() {
        return settle(table, ops, 'maybeSingle');
      },
      then(resolve, reject) {
        return settle(table, ops, 'then').then(resolve, reject);
      },
    };
    for (const method of builders) {
      target[method] = (...args) => {
        ops.push(op(method, ...args));
        return proxy;
      };
    }
    proxy = new Proxy(target, {
      get(object, property, receiver) {
        if (Reflect.has(object, property)) return Reflect.get(object, property, receiver);
        if (typeof property === 'symbol') return undefined;
        return (...args) => {
          violations.push(`unexpected method ${String(property)}(${JSON.stringify(args)}) on ${table}`);
          throw new Error(`unexpected fake method ${String(property)} on ${table}`);
        };
      },
    });
    return proxy;
  }

  const sb = {
    calls,
    authCalls,
    violations,
    from(table) {
      if (!pending.some((expected) => expected.kind === 'query' && expected.table === table)) {
        violations.push(`unexpected table ${table}`);
        throw new Error(`unexpected fake table ${table}`);
      }
      return chain(table);
    },
    async rpc(name, args) {
      const call = { kind: 'rpc', name, args };
      calls.push(call);
      violations.push(`unexpected RPC ${JSON.stringify(call)}`);
      throw new Error(`unexpected fake RPC ${name}`);
    },
    auth: {
      admin: {
        async getUserById(id) {
          authCalls.push(id);
          const index = pendingAuthUsers.findIndex((expected) => expected.id === id);
          if (index === -1) {
            violations.push(`unexpected Auth getUserById(${id})`);
            return { data: null, error: new Error('unexpected fake Auth lookup') };
          }
          const [expected] = pendingAuthUsers.splice(index, 1);
          return expected.result;
        },
      },
    },
    assertClean() {
      assert.deepEqual(violations, [], violations.join('\n'));
      assert.deepEqual(pending, [], `unconsumed fake queries: ${JSON.stringify(pending)}`);
      assert.deepEqual(pendingAuthUsers, [], `unconsumed fake Auth lookups: ${JSON.stringify(pendingAuthUsers)}`);
    },
  };
  return sb;
}

function participantThread(overrides = {}) {
  return {
    id: USER_THREAD_ID,
    participant_user_id: USER_ID,
    company_id: COMPANY_ID,
    status: 'open',
    completed_at: null,
    completed_by: null,
    last_message_at: '2026-09-06T14:00:00.000Z',
    last_message_body: 'Need help',
    last_sender_role: 'buyer',
    last_order_id: null,
    ...overrides,
  };
}

function companyThread(overrides = {}) {
  return participantThread({
    id: COMPANY_THREAD_ID,
    participant_user_id: null,
    last_message_body: 'Company question',
    last_sender_role: 'staff',
    ...overrides,
  });
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
    created_at: '2026-09-06T14:00:00.000Z',
    updated_at: NOW,
    version: 7,
    ...overrides,
  };
}

function foreignOrder() {
  return orderRow({ company_id: OTHER_COMPANY_ID, user_id: OTHER_USER_ID });
}

function absentOrder() {
  return null;
}

function buyerContext(sb, { companyId = COMPANY_ID } = {}) {
  return { user: { id: USER_ID, email: 'buyer@example.test' }, companyId, sb };
}

function staffContext(role = 'support') {
  return { user: { id: STAFF_ID, email: 'staff@masest.test' }, staff: true, role };
}

function routeRequest(path = '', method = 'GET') {
  return new Request(`https://masest.test/api/${path}`, { method });
}

async function responseShape(response) {
  return { status: response.status, body: await response.json() };
}

function buyerHandler(sb, { context = buyerContext(sb), body = {}, rateLimitResult = { ok: true }, publisher, now } = {}) {
  const authCalls = [];
  const bodyCalls = [];
  const publicationCalls = [];
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => {
      authCalls.push('auth');
      return context;
    },
    readBody: async () => {
      bodyCalls.push('body');
      return body;
    },
    rateLimit: async (...args) => {
      publicationCalls.push({ kind: 'rate_limit', args });
      return rateLimitResult;
    },
    publishSupportMessage: async (...args) => {
      publicationCalls.push({ kind: 'publication', args });
      if (publisher) return publisher(...args);
      return {
        message: {
          id: 'message-1', thread_id: USER_THREAD_ID, created_at: NOW,
          order_id: null, recipient_user_id: null,
        },
        emailDelivery: { ok: true },
      };
    },
    supportTicketsForThreads: async () => [],
    now: now || (() => new Date(NOW)),
  });
  const assertBoundaries = ({ auth = 1, parsedBody = 0, rateLimit = 0, publication = 0 } = {}) => {
    assert.equal(authCalls.length, auth, 'unexpected buyer authentication count');
    assert.equal(bodyCalls.length, parsedBody, 'unexpected buyer body-parse count');
    assert.equal(publicationCalls.filter((call) => call.kind === 'rate_limit').length, rateLimit, 'unexpected buyer rate-limit count');
    assert.equal(publicationCalls.filter((call) => call.kind === 'publication').length, publication, 'unexpected buyer publication count');
  };
  return { handler, authCalls, bodyCalls, publicationCalls, assertBoundaries };
}

function adminHandler(sb, {
  context = staffContext(),
  body = {},
  publisher,
  now,
  findThreadTicket = async (_sb, threadId) => supportTicket({ thread_id: threadId }),
  findTicket = async () => supportTicket(),
  patchTicket,
} = {}) {
  const authCalls = [];
  const bodyCalls = [];
  const publicationCalls = [];
  const clientCalls = [];
  const handler = createAdminMessagesHandler({
    requireStaff: async () => {
      authCalls.push('auth');
      return context;
    },
    adminClient: () => {
      clientCalls.push('admin_client');
      return sb;
    },
    readBody: async () => {
      bodyCalls.push('body');
      return body;
    },
    publishSupportMessage: async (...args) => {
      publicationCalls.push(args);
      if (publisher) return publisher(...args);
      return {
        message: {
          id: 'message-2', thread_id: USER_THREAD_ID, created_at: NOW,
          order_id: null, recipient_user_id: USER_ID,
        },
        emailDelivery: { ok: true },
      };
    },
    supportTicketById: findTicket,
    supportTicketForThread: findThreadTicket,
    ...(patchTicket ? { updateSupportTicket: patchTicket } : {}),
    now: now || (() => new Date(NOW)),
  });
  const assertBoundaries = ({ auth = 1, adminClient = 1, parsedBody = 0, publication = 0 } = {}) => {
    assert.equal(authCalls.length, auth, 'unexpected staff authentication count');
    assert.equal(clientCalls.length, adminClient, 'unexpected admin-client count');
    assert.equal(bodyCalls.length, parsedBody, 'unexpected staff body-parse count');
    assert.equal(publicationCalls.length, publication, 'unexpected staff publication count');
  };
  return { handler, authCalls, bodyCalls, publicationCalls, clientCalls, assertBoundaries };
}

function publisherSuccess(overrides = {}) {
  return async () => ({
    message: {
      id: 'message-1',
      thread_id: USER_THREAD_ID,
      created_at: NOW,
      order_id: null,
      recipient_user_id: null,
      ...overrides,
    },
    emailDelivery: { ok: true, delivered: true },
  });
}

function publisherRetryableEmailFailure(overrides = {}) {
  return async () => ({
    message: {
      id: 'message-1',
      thread_id: USER_THREAD_ID,
      created_at: NOW,
      order_id: null,
      recipient_user_id: null,
      ...overrides,
    },
    emailDelivery: { ok: false, retryable: true, error: 'support_email_delivery_failed' },
  });
}

function publisherInsertFailure() {
  return async () => {
    throw new Error('append failed');
  };
}

test('buyer with no support threads receives an empty inbox', async () => {
  const sb = strictSupabase([
    single('support_threads', [
      op('select', 'id'),
      op('eq', 'participant_user_id', USER_ID),
    ], { data: null, error: null }),
    single('support_threads', [
      op('select', 'id'),
      op('eq', 'company_id', COMPANY_ID),
      op('is', 'participant_user_id', null),
    ], { data: null, error: null }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb);
  const response = await handler({ request: routeRequest('account/messages'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: { messages: [], has_more: false, next_before: null, tickets: [], ticket: null, order_scope: null },
  });
  assertBoundaries();
  sb.assertClean();
});

test('buyer authentication and context errors pass through without database or publication I/O', async (t) => {
  const cases = [
    ['unauthenticated', 401, { error: 'unauthenticated' }],
    ['context unavailable', 503, { error: 'commerce_context_unavailable', retryable: true }],
  ];
  for (const [name, status, body] of cases) {
    await t.test(name, async () => {
      const sb = strictSupabase();
      const contextError = new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
      const { handler, authCalls, publicationCalls, assertBoundaries } = buyerHandler(sb, {
        context: { error: contextError },
      });
      const response = await handler({ request: routeRequest('account/messages'), env: {} });
      assert.deepEqual(await responseShape(response), { status, body });
      assert.deepEqual(authCalls, ['auth']);
      assert.deepEqual(publicationCalls, []);
      assertBoundaries();
      sb.assertClean();
    });
  }
});

test('buyer inbox combines participant and Company threads and marks only staff messages read', async () => {
  let messagesLoaded = false;
  const older = {
    id: 'message-old', thread_id: COMPANY_THREAD_ID, sender_role: 'buyer', body: 'Earlier',
    order_id: null, source: 'dashboard', created_at: '2026-09-06T13:00:00.000Z',
  };
  const newer = {
    id: 'message-new', thread_id: USER_THREAD_ID, sender_role: 'staff', body: 'Latest',
    order_id: null, source: 'admin', created_at: '2026-09-06T14:00:00.000Z',
  };
  const messageRead = query('messages', [
    op('select', BUYER_MESSAGE_SELECT),
    op('in', 'thread_id', [USER_THREAD_ID, COMPANY_THREAD_ID]),
    op('order', 'created_at', { ascending: false }),
    op('limit', 201),
  ], { data: [newer, older], error: null });
  messageRead.onSettle = () => { messagesLoaded = true; };
  const readReceipt = query('messages', [
    op('update', { read_by_user: true }),
    op('in', 'thread_id', [USER_THREAD_ID, COMPANY_THREAD_ID]),
    op('eq', 'sender_role', 'staff'),
    op('eq', 'read_by_user', false),
  ], { data: null, error: null });
  readReceipt.onSettle = () => assert.equal(messagesLoaded, true, 'read receipt must follow message load');
  const sb = strictSupabase([
    single('support_threads', [op('select', 'id'), op('eq', 'participant_user_id', USER_ID)], {
      data: { id: USER_THREAD_ID }, error: null,
    }),
    single('support_threads', [
      op('select', 'id'), op('eq', 'company_id', COMPANY_ID), op('is', 'participant_user_id', null),
    ], { data: { id: COMPANY_THREAD_ID }, error: null }),
    messageRead,
    readReceipt,
  ]);
  const { handler, authCalls, assertBoundaries } = buyerHandler(sb);

  const response = await handler({ request: routeRequest('account/messages'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      messages: [{ ...older, order: null }, { ...newer, order: null }],
      has_more: false,
      next_before: null,
      tickets: [],
      ticket: null,
      order_scope: null,
    },
  });
  assert.deepEqual(authCalls, ['auth']);
  assertBoundaries();
  sb.assertClean();
});

test('buyer peek reads the participant thread without writing read receipts', async () => {
  const row = {
    id: 'message-1', thread_id: USER_THREAD_ID, sender_role: 'staff', body: 'Unread',
    order_id: null, source: 'admin', created_at: NOW,
  };
  const sb = strictSupabase([
    single('support_threads', [op('select', 'id'), op('eq', 'participant_user_id', USER_ID)], {
      data: { id: USER_THREAD_ID }, error: null,
    }),
    query('messages', [
      op('select', BUYER_MESSAGE_SELECT),
      op('in', 'thread_id', [USER_THREAD_ID]),
      op('order', 'created_at', { ascending: false }),
      op('limit', 201),
    ], { data: [row], error: null }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb, { context: buyerContext(sb, { companyId: null }) });

  const response = await handler({ request: routeRequest('account/messages?peek=1'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      messages: [{ ...row, order: null }], has_more: false, next_before: null,
      tickets: [], ticket: null, order_scope: null,
    },
  });
  assert.equal(sb.calls.some((call) => call.ops?.some((entry) => entry.method === 'update')), false);
  assertBoundaries();
  sb.assertClean();
});

test('buyer GET retains valid order scope in query, read receipt, and response', async () => {
  const order = orderRow();
  const orderContext = {
    id: ORDER_ID,
    reference: 'MST-1042',
    status: 'paid',
    buyer_url: `/dashboard.html?order=${ORDER_ID}#orders`,
    admin_url: `/admin.html?order=${ORDER_ID}#orders`,
  };
  const row = {
    id: 'message-1', thread_id: USER_THREAD_ID, sender_role: 'staff', body: 'Order update',
    order_id: ORDER_ID, source: 'admin', created_at: NOW,
  };
  const sb = strictSupabase([
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], { data: order, error: null }),
    single('support_threads', [op('select', 'id'), op('eq', 'participant_user_id', USER_ID)], {
      data: { id: USER_THREAD_ID }, error: null,
    }),
    single('support_threads', [
      op('select', 'id'), op('eq', 'company_id', COMPANY_ID), op('is', 'participant_user_id', null),
    ], { data: null, error: null }),
    query('messages', [
      op('select', BUYER_MESSAGE_SELECT), op('in', 'thread_id', [USER_THREAD_ID]),
      op('order', 'created_at', { ascending: false }), op('limit', 201), op('eq', 'order_id', ORDER_ID),
    ], { data: [row], error: null }),
    query('messages', [
      op('update', { read_by_user: true }), op('in', 'thread_id', [USER_THREAD_ID]),
      op('eq', 'sender_role', 'staff'), op('eq', 'read_by_user', false), op('eq', 'order_id', ORDER_ID),
    ], { data: null, error: null }),
    query('orders', [op('select', ORDER_CONTEXT_SELECT), op('in', 'id', [ORDER_ID])], {
      data: [order], error: null,
    }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb);

  const response = await handler({ request: routeRequest(`account/messages?order_id=${ORDER_ID}`), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      messages: [{ ...row, order: orderContext }],
      has_more: false,
      next_before: null,
      tickets: [],
      ticket: null,
      order_scope: orderContext,
    },
  });
  assertBoundaries();
  sb.assertClean();
});

test('buyer GET scopes an explicit owned ticket and returns only its safe projection', async () => {
  const filters = [];
  const builder = {
    select() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    lt() { return this; },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => buyerContext({ from: () => builder }),
    visibleSupportThreadIds: async () => [USER_THREAD_ID],
    supportTicketsForThreads: async () => [supportTicket({ assigned_to: STAFF_ID, version: 9 })],
  });

  const response = await handler({
    request: routeRequest(`account/messages?peek=1&ticket_id=${TICKET_ID}`), env: {},
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [['ticket_id', TICKET_ID]]);
  assert.equal(payload.ticket.id, TICKET_ID);
  assert.equal(payload.ticket.assigned_to, undefined);
  assert.equal(payload.ticket.version, undefined);
});

test('buyer cannot read a foreign or absent order scope', async (t) => {
  for (const [name, data] of [['foreign', foreignOrder()], ['absent', absentOrder()]]) {
    await t.test(name, async () => {
      const sb = strictSupabase([
        single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], { data, error: null }),
      ]);
      const { handler, assertBoundaries } = buyerHandler(sb);
      const response = await handler({ request: routeRequest(`account/messages?order_id=${ORDER_ID}`), env: {} });
      assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'order_not_found' } });
      assertBoundaries();
      sb.assertClean();
    });
  }
});

test('buyer presence requires a boolean before touching the profile', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = buyerHandler(sb, { body: { action: 'chat_presence', chat_open: 'true' } });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 400, body: { error: 'chat_open_required' } });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('buyer presence updates only the authenticated profile using the injected clock', async () => {
  const sb = strictSupabase([
    query('profiles', [
      op('update', { support_chat_open: true, support_chat_seen_at: NOW }),
      op('eq', 'id', USER_ID),
    ], { data: null, error: null }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb, { body: { action: 'chat_presence', chat_open: true } });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: { support_chat_open: true, support_chat_seen_at: NOW },
  });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('buyer message rate limit returns retry metadata before publication', async () => {
  const sb = strictSupabase();
  const { handler, publicationCalls, assertBoundaries } = buyerHandler(sb, {
    body: { body: 'Please help' },
    rateLimitResult: { ok: false, retryAfter: 17 },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 429, body: { error: 'rate_limited' } });
  assert.equal(response.headers.get('retry-after'), '17');
  assert.equal(publicationCalls.length, 1);
  assert.equal(publicationCalls[0].kind, 'rate_limit');
  assert.deepEqual(publicationCalls[0].args.slice(1), ['support-message', USER_ID, { limit: 10, windowSec: 60 }]);
  assertBoundaries({ parsedBody: 1, rateLimit: 1 });
  sb.assertClean();
});

test('buyer empty messages fail after rate limiting and before publication', async () => {
  const sb = strictSupabase();
  const { handler, publicationCalls, assertBoundaries } = buyerHandler(sb, { body: { body: '   ' } });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 400, body: { error: 'empty_message' } });
  assert.deepEqual(publicationCalls.map((call) => call.kind), ['rate_limit']);
  assertBoundaries({ parsedBody: 1, rateLimit: 1 });
  sb.assertClean();
});

test('buyer 4,001-character messages fail after rate limiting and before publication', async () => {
  const sb = strictSupabase();
  const { handler, publicationCalls, assertBoundaries } = buyerHandler(sb, { body: { body: 'x'.repeat(4001) } });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 400, body: { error: 'message_too_long' } });
  assert.deepEqual(publicationCalls.map((call) => call.kind), ['rate_limit']);
  assertBoundaries({ parsedBody: 1, rateLimit: 1 });
  sb.assertClean();
});

test('retail buyer without a Company can publish general support', async () => {
  const sb = strictSupabase();
  const { handler, publicationCalls, assertBoundaries } = buyerHandler(sb, {
    context: buyerContext(sb, { companyId: null }),
    body: { body: ' Retail support ', source: 'dashboard' },
    publisher: publisherSuccess(),
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 201,
    body: {
      id: 'message-1', thread_id: USER_THREAD_ID, created_at: NOW, order_id: null,
      email_delivery: { ok: true, delivered: true }, summary_synced: true,
    },
  });
  const publication = publicationCalls.find((call) => call.kind === 'publication');
  assert.deepEqual(publication.args[2], {
    companyId: null,
    userId: USER_ID,
    threadUserId: USER_ID,
    senderRole: 'buyer',
    body: 'Retail support',
    orderId: null,
    source: 'dashboard',
    ticketId: null,
    threadId: null,
    subject: 'Retail support',
    category: 'general',
    startTicket: false,
  });
  assertBoundaries({ parsedBody: 1, rateLimit: 1, publication: 1 });
  sb.assertClean();
});

test('buyer publisher receives exact actor, thread, order, source, body, and default APP_URL', async () => {
  const sb = strictSupabase([
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], {
      data: orderRow(), error: null,
    }),
  ]);
  const { handler, publicationCalls, assertBoundaries } = buyerHandler(sb, {
    body: { body: '  Valve leaking  ', source: 'customer_chat', order_id: ORDER_ID },
    publisher: publisherSuccess({ order_id: ORDER_ID }),
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: { CUSTOM: 'value' } });

  assert.deepEqual(await responseShape(response), {
    status: 201,
    body: {
      id: 'message-1', thread_id: USER_THREAD_ID, created_at: NOW, order_id: ORDER_ID,
      email_delivery: { ok: true, delivered: true }, summary_synced: true,
    },
  });
  const publication = publicationCalls.find((call) => call.kind === 'publication');
  assert.deepEqual(publication.args[0], { CUSTOM: 'value', APP_URL: 'https://masest.test' });
  assert.equal(publication.args[1], sb);
  assert.deepEqual(publication.args[2], {
    companyId: COMPANY_ID,
    userId: USER_ID,
    threadUserId: USER_ID,
    senderRole: 'buyer',
    body: 'Valve leaking',
    orderId: ORDER_ID,
    source: 'customer_chat',
    ticketId: null,
    threadId: null,
    subject: 'Valve leaking',
    category: 'general',
    startTicket: false,
  });
  assertBoundaries({ parsedBody: 1, rateLimit: 1, publication: 1 });
  sb.assertClean();
});

test('buyer POST rejects a foreign order before publication', async () => {
  const sb = strictSupabase([
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], {
      data: foreignOrder(), error: null,
    }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb, {
    body: { body: 'Question about order', order_id: ORDER_ID },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'order_not_found' } });
  assertBoundaries({ parsedBody: 1, rateLimit: 1 });
  sb.assertClean();
});

test('buyer retains the canonical message when email delivery is retryable', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = buyerHandler(sb, {
    body: { body: 'Need help' },
    publisher: publisherRetryableEmailFailure(),
  });
  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 201,
    body: {
      id: 'message-1', thread_id: USER_THREAD_ID, created_at: NOW, order_id: null,
      email_delivery: { ok: false, retryable: true, error: 'support_email_delivery_failed' },
      summary_synced: true,
    },
  });
  assertBoundaries({ parsedBody: 1, rateLimit: 1, publication: 1 });
  sb.assertClean();
});

test('buyer database errors expose only server_error', async () => {
  const failure = new Error('database secret detail');
  const sb = strictSupabase([
    single('support_threads', [op('select', 'id'), op('eq', 'participant_user_id', USER_ID)], {
      data: null, error: failure,
    }),
    single('support_threads', [
      op('select', 'id'), op('eq', 'company_id', COMPANY_ID), op('is', 'participant_user_id', null),
    ], { data: null, error: null }),
  ]);
  const { handler, assertBoundaries } = buyerHandler(sb);
  const response = await handler({ request: routeRequest('account/messages'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 500, body: { error: 'server_error' } });
  assertBoundaries();
  sb.assertClean();
});

test('buyer publication insert errors expose only server_error', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = buyerHandler(sb, {
    body: { body: 'Need help' },
    publisher: publisherInsertFailure(),
  });
  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 500, body: { error: 'server_error' } });
  assertBoundaries({ parsedBody: 1, rateLimit: 1, publication: 1 });
  sb.assertClean();
});

test('staff authentication distinguishes unauthenticated and non-staff callers before I/O', async (t) => {
  const cases = [
    ['unauthenticated', { user: null, staff: false, role: null }, 401, { error: 'unauthenticated' }],
    ['non-staff', { user: { id: OTHER_USER_ID }, staff: false, role: null }, 403, { error: 'forbidden' }],
  ];
  for (const [name, context, status, body] of cases) {
    await t.test(name, async () => {
      const sb = strictSupabase();
      const { handler, assertBoundaries } = adminHandler(sb, { context });
      const response = await handler({ request: routeRequest('admin/messages'), env: {} });
      assert.deepEqual(await responseShape(response), { status, body });
      assertBoundaries({ adminClient: 0 });
      sb.assertClean();
    });
  }
});

test('read-only staff cannot PATCH or POST and body parsing never runs', async (t) => {
  for (const method of ['PATCH', 'POST']) {
    await t.test(method, async () => {
      const sb = strictSupabase();
      const { handler, assertBoundaries } = adminHandler(sb, {
        context: staffContext('read_only'),
        body: { thread_id: USER_THREAD_ID, body: 'Must not parse' },
      });
      const response = await handler({ request: routeRequest('admin/messages', method), env: {} });
      assert.deepEqual(await responseShape(response), {
        status: 403,
        body: { error: 'forbidden', message: 'Read-only staff cannot make changes.' },
      });
      assertBoundaries();
      sb.assertClean();
    });
  }
});

test('owner summary returns exact open and unanswered counts', async () => {
  const summarySelect = [
    op('select', 'id', { count: 'exact', head: true }),
    op('not', 'last_message_at', 'is', null),
    op('neq', 'status', 'resolved'),
  ];
  const sb = strictSupabase([
    query('support_tickets', summarySelect, { data: null, count: 7, error: null }),
    query('support_tickets', [...summarySelect, op('eq', 'last_sender_role', 'buyer')], {
      data: null, count: 3, error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, { context: staffContext('owner') });

  const response = await handler({ request: routeRequest('admin/messages?summary=1'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: { summary: { open: 7, unanswered: 3 } },
  });
  assertBoundaries();
  sb.assertClean();
});

test('staff list hydrates participants, companies, and order context without Auth lookups', async () => {
  const rows = [participantThread({ last_order_id: ORDER_ID }), companyThread()];
  const tickets = [
    supportTicket({ primary_order_id: ORDER_ID }),
    supportTicket({
      id: OTHER_TICKET_ID,
      ticket_number: 124,
      thread_id: COMPANY_THREAD_ID,
      subject: 'Company question',
      last_message_body: 'Company question',
      last_sender_role: 'staff',
    }),
  ];
  const orderContext = {
    id: ORDER_ID,
    reference: 'MST-1042',
    status: 'paid',
    buyer_url: `/dashboard.html?order=${ORDER_ID}#orders`,
    admin_url: `/admin.html?order=${ORDER_ID}#orders`,
  };
  const sb = strictSupabase([
    query('support_tickets', [
      op('select', SUPPORT_TICKET_SELECT), op('not', 'last_message_at', 'is', null),
      op('neq', 'status', 'resolved'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
    ], { data: tickets, error: null }),
    query('support_threads', [op('select', THREAD_SELECT), op('in', 'id', [USER_THREAD_ID, COMPANY_THREAD_ID])], {
      data: rows, error: null,
    }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
    query('orders', [op('select', ORDER_CONTEXT_SELECT), op('in', 'id', [ORDER_ID])], {
      data: [orderRow()], error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb);

  const response = await handler({ request: routeRequest('admin/messages?status=open'), env: {} });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.threads.map(({ ticket_id, ticket, ...thread }) => thread),
    [
        {
          thread_id: USER_THREAD_ID,
          company_id: COMPANY_ID,
          company_name: 'Acme HVAC',
          participant_user_id: USER_ID,
          participant: { id: USER_ID, full_name: 'Ada Buyer', email: null },
          scope: 'user',
          last_body: 'Need help',
          last_at: NOW,
          status: 'open',
          completed_at: null,
          unanswered: true,
          order: orderContext,
        },
        {
          thread_id: COMPANY_THREAD_ID,
          company_id: COMPANY_ID,
          company_name: 'Acme HVAC',
          participant_user_id: null,
          participant: null,
          scope: 'company',
          last_body: 'Company question',
          last_at: NOW,
          status: 'open',
          completed_at: null,
          unanswered: false,
          order: null,
        },
      ],
  );
  assert.deepEqual(payload.threads.map(({ ticket_id }) => ticket_id), [TICKET_ID, OTHER_TICKET_ID]);
  assert.deepEqual(payload.threads.map(({ ticket }) => ticket.version), [7, 7]);
  assert.deepEqual(payload.summary, { open: 2, unanswered: 1 });
  assert.deepEqual(sb.authCalls, []);
  assertBoundaries();
  sb.assertClean();
});

test('read-only staff can list completed threads with the resolved summary contract', async () => {
  const completedAt = '2026-09-06T13:30:00.000Z';
  const row = participantThread({
    status: 'complete', completed_at: completedAt, completed_by: STAFF_ID, last_sender_role: 'staff',
  });
  const ticket = supportTicket({
    status: 'resolved', resolved_at: completedAt, last_sender_role: 'staff',
  });
  const sb = strictSupabase([
    query('support_tickets', [
      op('select', SUPPORT_TICKET_SELECT), op('not', 'last_message_at', 'is', null),
      op('eq', 'status', 'resolved'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
    ], { data: [ticket], error: null }),
    query('support_threads', [op('select', THREAD_SELECT), op('in', 'id', [USER_THREAD_ID])], {
      data: [row], error: null,
    }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, { context: staffContext('read_only') });

  const response = await handler({ request: routeRequest('admin/messages?status=complete'), env: {} });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.threads.map(({ ticket_id, ticket: projectedTicket, ...thread }) => thread), [{
        thread_id: USER_THREAD_ID,
        company_id: COMPANY_ID,
        company_name: 'Acme HVAC',
        participant_user_id: USER_ID,
        participant: { id: USER_ID, full_name: 'Ada Buyer', email: null },
        scope: 'user',
        last_body: 'Need help',
        last_at: NOW,
        status: 'complete',
        completed_at: completedAt,
        unanswered: false,
        order: null,
      }]);
  assert.equal(payload.threads[0].ticket_id, TICKET_ID);
  assert.equal(payload.threads[0].ticket.status, 'resolved');
  assert.deepEqual(payload.summary, { resolved: 1 });
  assert.deepEqual(sb.authCalls, []);
  assertBoundaries();
  sb.assertClean();
});

test('staff detail returns the exact participant thread and marks only buyer messages read', async () => {
  let messagesLoaded = false;
  const thread = participantThread();
  const participant = { id: USER_ID, full_name: 'Ada Buyer', email: 'buyer@example.test' };
  const older = {
    id: 'message-old', thread_id: USER_THREAD_ID, sender_role: 'buyer', user_id: USER_ID,
    recipient_user_id: null, body: 'Earlier', order_id: null, created_at: '2026-09-06T13:00:00.000Z',
    read_by_staff: false, source: 'dashboard', external_message_id: null, email_delivery_id: null,
    email_message_id: null, email_references: null,
  };
  const newer = {
    ...older,
    id: 'message-new', sender_role: 'staff', user_id: null, recipient_user_id: USER_ID,
    body: 'Latest', created_at: '2026-09-06T14:00:00.000Z', read_by_staff: true, source: 'admin',
  };
  const messageRead = query('messages', [
    op('select', STAFF_MESSAGE_SELECT), op('eq', 'thread_id', USER_THREAD_ID),
    op('order', 'created_at', { ascending: false }), op('limit', 201),
  ], { data: [newer, older], error: null });
  messageRead.onSettle = () => { messagesLoaded = true; };
  const readReceipt = query('messages', [
    op('update', { read_by_staff: true }), op('eq', 'thread_id', USER_THREAD_ID),
    op('eq', 'sender_role', 'buyer'), op('eq', 'read_by_staff', false),
  ], { data: null, error: null });
  readReceipt.onSettle = () => assert.equal(messagesLoaded, true, 'read receipt must follow message load');
  const sb = strictSupabase([
    single('support_threads', [op('select', THREAD_SELECT), op('eq', 'id', USER_THREAD_ID)], {
      data: thread, error: null,
    }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
    messageRead,
    readReceipt,
  ], {
    authUsers: [{ id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } }],
  });
  const { handler, assertBoundaries } = adminHandler(sb);

  const response = await handler({ request: routeRequest(`admin/messages?thread_id=${USER_THREAD_ID}`), env: {} });

  const payload = await response.json();
  const { ticket_id: ticketId, ticket, ...legacyThread } = payload.thread;
  assert.equal(response.status, 200);
  assert.deepEqual(payload.messages, [
    { ...older, order: null, participant },
    { ...newer, order: null, participant },
  ]);
  assert.equal(payload.has_more, false);
  assert.equal(payload.next_before, null);
  assert.deepEqual(legacyThread, {
        thread_id: USER_THREAD_ID,
        company_id: COMPANY_ID,
        company_name: 'Acme HVAC',
        company_status: 'approved',
        participant_user_id: USER_ID,
        participant,
        scope: 'user',
        status: 'open',
        completed_at: null,
        order_scope: null,
  });
  assert.equal(ticketId, TICKET_ID);
  assert.equal(ticket.id, TICKET_ID);
  assert.equal(ticket.version, 7);
  assertBoundaries();
  sb.assertClean();
});

test('staff detail falls back to an exact Company thread before it exists', async () => {
  const sb = strictSupabase([
    single('support_threads', [
      op('select', THREAD_SELECT), op('eq', 'company_id', COMPANY_ID), op('is', 'participant_user_id', null),
    ], { data: null, error: null }),
    single('companies', [op('select', COMPANY_SELECT), op('eq', 'id', COMPANY_ID)], {
      data: { id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }, error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb);

  const response = await handler({ request: routeRequest(`admin/messages?company_id=${COMPANY_ID}`), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      messages: [],
      has_more: false,
      next_before: null,
      thread: {
        thread_id: null,
        company_id: COMPANY_ID,
        company_name: 'Acme HVAC',
        company_status: 'approved',
        participant_user_id: null,
        participant: null,
        scope: 'company',
        status: 'open',
        completed_at: null,
        order_scope: null,
      },
    },
  });
  assertBoundaries();
  sb.assertClean();
});

test('staff detail rejects order scope outside the selected participant and Company', async () => {
  const sb = strictSupabase([
    single('support_threads', [op('select', THREAD_SELECT), op('eq', 'id', USER_THREAD_ID)], {
      data: participantThread(), error: null,
    }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], {
      data: foreignOrder(), error: null,
    }),
  ], {
    authUsers: [{ id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } }],
  });
  const { handler, assertBoundaries } = adminHandler(sb);
  const response = await handler({
    request: routeRequest(`admin/messages?thread_id=${USER_THREAD_ID}&order_id=${ORDER_ID}`),
    env: {},
  });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'order_not_found' } });
  assertBoundaries();
  sb.assertClean();
});

test('staff PATCH preserves open, escalated, and complete lifecycle transitions', async (t) => {
  const cases = [
    ['open', { status: 'open', priority: 'normal', resolved_at: null }],
    ['escalated', { status: 'open', priority: 'high', resolved_at: null }],
    ['complete', { status: 'resolved', priority: 'normal', resolved_at: NOW }],
  ];
  for (const [status, updatedFields] of cases) {
    await t.test(status, async () => {
      const sb = strictSupabase();
      let updateInput;
      const { handler, assertBoundaries } = adminHandler(sb, {
        body: { thread_id: USER_THREAD_ID, status },
        patchTicket: async (_sb, input) => {
          updateInput = input;
          return supportTicket({ ...updatedFields, version: 8 });
        },
      });
      const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.thread_id, USER_THREAD_ID);
      assert.equal(payload.ticket_id, TICKET_ID);
      assert.equal(payload.status, status);
      assert.equal(updateInput.expectedVersion, 7);
      assert.equal(updateInput.actorId, STAFF_ID);
      assertBoundaries({ parsedBody: 1 });
      sb.assertClean();
    });
  }
});

test('staff PATCH validates thread identity and lifecycle status before database I/O', async (t) => {
  const cases = [
    ['missing thread id', { status: 'open' }, { error: 'thread_id_required' }],
    ['invalid status', { thread_id: USER_THREAD_ID, status: 'closed' }, { error: 'invalid_status' }],
  ];
  for (const [name, body, expectedBody] of cases) {
    await t.test(name, async () => {
      const sb = strictSupabase();
      const { handler, assertBoundaries } = adminHandler(sb, { body });
      const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
      assert.deepEqual(await responseShape(response), { status: 400, body: expectedBody });
      assertBoundaries({ parsedBody: 1 });
      sb.assertClean();
    });
  }
});

test('staff PATCH returns thread_not_found when the selected thread disappeared', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { thread_id: USER_THREAD_ID, status: 'open' },
    findThreadTicket: async () => null,
  });
  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'thread_not_found' } });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('staff PATCH masks database update errors', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { thread_id: USER_THREAD_ID, status: 'open' },
    patchTicket: async () => { throw new Error('database secret detail'); },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
    assert.deepEqual(await responseShape(response), { status: 500, body: { error: 'server_error' } });
  } finally {
    console.error = originalConsoleError;
  }
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('staff POST requires an explicit recipient when starting a thread', async () => {
  const sb = strictSupabase();
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { start_thread: true, body: 'Hello' },
  });
  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 400,
    body: { error: 'recipient_user_id_required' },
  });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('legacy New chat composer keeps default-ticket routing and explicit reopen through the real append helper', async () => {
  let rpcCall;
  const sb = {
    async rpc(name, args) {
      rpcCall = { name, args };
      return {
        data: {
          id: 'legacy-new-chat-message', thread_id: USER_THREAD_ID, ticket_id: TICKET_ID,
          created_at: NOW, order_id: null, recipient_user_id: USER_ID,
          ticket: supportTicket(),
        },
        error: null,
      };
    },
    from(table) {
      assert.equal(table, 'notifications');
      return { async insert() { return { data: null, error: null }; } };
    },
  };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => sb,
    readBody: async () => ({
      recipient_user_id: USER_ID,
      body: 'Welcome to MASEST support.',
      start_thread: true,
    }),
    resolveSupportRecipient: async () => ({ id: USER_ID, company_id: COMPANY_ID }),
    publishSupportMessage: (env, client, input) => publishSupportMessage(env, client, input, {
      append: appendSupportMessage,
      deliver: async () => ({ ok: true, skipped: 'test_delivery' }),
    }),
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.equal(response.status, 201);
  assert.equal(rpcCall.name, 'append_support_message');
  assert.equal(rpcCall.args.p_contract_version, 2);
  assert.equal(rpcCall.args.p_start_ticket, false);
  assert.equal(rpcCall.args.p_reopen, true);
  assert.equal(rpcCall.args.p_recipient_user_id, USER_ID);
});

test('explicit staff ticket creation reports the pre-activation gate without masking it', async () => {
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({}),
    readBody: async () => ({
      recipient_user_id: USER_ID,
      body: 'A distinct issue',
      start_ticket: true,
    }),
    resolveSupportRecipient: async () => ({ id: USER_ID, company_id: COMPANY_ID }),
    publishSupportMessage: async () => {
      throw new Error('support_ticket_routing_not_enabled');
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 409,
    body: { error: 'support_ticket_routing_not_enabled' },
  });
});

test('staff POST returns thread_not_found for a missing selected thread', async () => {
  const sb = strictSupabase([
    single('support_threads', [op('select', THREAD_SELECT), op('eq', 'id', USER_THREAD_ID)], {
      data: null, error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { thread_id: USER_THREAD_ID, body: 'Hello' },
  });
  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'thread_not_found' } });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('staff POST rejects empty and 4,001-character replies before database I/O', async (t) => {
  const cases = [
    ['empty', '   ', { error: 'empty_message' }],
    ['oversized', 'x'.repeat(4001), { error: 'message_too_long' }],
  ];
  for (const [name, body, expectedBody] of cases) {
    await t.test(name, async () => {
      const sb = strictSupabase();
      const { handler, assertBoundaries } = adminHandler(sb, { body: { body } });
      const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });
      assert.deepEqual(await responseShape(response), { status: 400, body: expectedBody });
      assertBoundaries({ parsedBody: 1 });
      sb.assertClean();
    });
  }
});

test('selected staff thread fixes participant and Company identity for ordered reply and notification', async () => {
  let published = false;
  const notification = {
    company_id: COMPANY_ID,
    user_id: USER_ID,
    type: 'message',
    title: 'New message from MASEST',
    body: 'Order update is ready',
    link: `/dashboard.html?order=${ORDER_ID}#messages`,
  };
  const notificationQuery = query('notifications', [op('insert', notification)], { data: null, error: null });
  notificationQuery.onSettle = () => assert.equal(published, true, 'publication must finish before notification');
  const sb = strictSupabase([
    single('support_threads', [op('select', THREAD_SELECT), op('eq', 'id', USER_THREAD_ID)], {
      data: participantThread(), error: null,
    }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
    single('profiles', [
      op('select', RECIPIENT_SELECT), op('eq', 'id', USER_ID), op('eq', 'company_id', COMPANY_ID),
    ], {
      data: {
        id: USER_ID, company_id: COMPANY_ID, full_name: 'Ada Buyer', notify_messages: true,
        support_chat_open: false, support_chat_seen_at: null,
      },
      error: null,
    }),
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], {
      data: orderRow(), error: null,
    }),
    notificationQuery,
  ], {
    authUsers: [
      { id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } },
      { id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } },
    ],
  });
  const publisher = async () => {
    published = true;
    return publisherSuccess({ order_id: ORDER_ID, recipient_user_id: USER_ID })();
  };
  const { handler, publicationCalls, assertBoundaries } = adminHandler(sb, {
    body: {
      thread_id: USER_THREAD_ID,
      company_id: OTHER_COMPANY_ID,
      recipient_user_id: OTHER_USER_ID,
      order_id: ORDER_ID,
      body: '  Order update is ready  ',
    },
    publisher,
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: { CUSTOM: 'value' } });

  assert.deepEqual(await responseShape(response), {
    status: 201,
    body: {
      id: 'message-1',
      thread_id: USER_THREAD_ID,
      created_at: NOW,
      order_id: ORDER_ID,
      recipient_user_id: USER_ID,
      email_delivery: { ok: true, delivered: true },
      summary_synced: true,
    },
  });
  assert.deepEqual(publicationCalls[0][0], { CUSTOM: 'value', APP_URL: 'https://masest.test' });
  assert.equal(publicationCalls[0][1], sb);
  assert.deepEqual(publicationCalls[0][2], {
    companyId: COMPANY_ID,
    recipientUserId: USER_ID,
    threadUserId: USER_ID,
    threadId: USER_THREAD_ID,
    ticketId: null,
    senderRole: 'staff',
    body: 'Order update is ready',
    orderId: ORDER_ID,
    source: 'admin',
    reopen: null,
    subject: 'Order update is ready',
    category: 'general',
    startTicket: false,
  });
  assertBoundaries({ parsedBody: 1, publication: 1 });
  sb.assertClean();
});

test('staff POST rejects a foreign order before publication or notification', async () => {
  const sb = strictSupabase([
    single('profiles', [
      op('select', RECIPIENT_SELECT), op('eq', 'id', USER_ID), op('eq', 'company_id', COMPANY_ID),
    ], {
      data: {
        id: USER_ID, company_id: COMPANY_ID, full_name: 'Ada Buyer', notify_messages: true,
        support_chat_open: false, support_chat_seen_at: null,
      },
      error: null,
    }),
    single('orders', [op('select', ORDER_SELECT), op('eq', 'id', ORDER_ID)], {
      data: foreignOrder(), error: null,
    }),
  ], {
    authUsers: [{ id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } }],
  });
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: {
      company_id: COMPANY_ID,
      recipient_user_id: USER_ID,
      order_id: ORDER_ID,
      body: 'Question about order',
    },
  });
  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'order_not_found' } });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('staff publication insert errors expose only server_error', async () => {
  const sb = strictSupabase([
    single('profiles', [op('select', RECIPIENT_SELECT), op('eq', 'id', USER_ID)], {
      data: {
        id: USER_ID, company_id: COMPANY_ID, full_name: 'Ada Buyer', notify_messages: true,
        support_chat_open: false, support_chat_seen_at: null,
      },
      error: null,
    }),
  ], {
    authUsers: [{ id: USER_ID, result: { data: { user: { email: 'buyer@example.test' } }, error: null } }],
  });
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { recipient_user_id: USER_ID, body: 'Hello' },
    publisher: publisherInsertFailure(),
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });
    assert.deepEqual(await responseShape(response), { status: 500, body: { error: 'server_error' } });
  } finally {
    console.error = originalConsoleError;
  }
  assertBoundaries({ parsedBody: 1, publication: 1 });
  sb.assertClean();
});

test('staff database errors expose only server_error', async () => {
  const sb = strictSupabase([
    query('support_tickets', [
      op('select', SUPPORT_TICKET_SELECT), op('not', 'last_message_at', 'is', null),
      op('neq', 'status', 'resolved'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
    ], { data: null, error: new Error('database secret detail') }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handler({ request: routeRequest('admin/messages'), env: {} });
    assert.deepEqual(await responseShape(response), { status: 500, body: { error: 'server_error' } });
  } finally {
    console.error = originalConsoleError;
  }
  assertBoundaries();
  sb.assertClean();
});

test('buyer can explicitly start a distinct ticket and receives only the buyer-safe projection', async () => {
  let publishedInput;
  const ticket = supportTicket();
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => buyerContext({}),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({
      action: 'start_ticket',
      body: '  Pump pressure changed  ',
      subject: '  Pump-room scaling  ',
      category: 'technical',
    }),
    publishSupportMessage: async (_env, _sb, input) => {
      publishedInput = input;
      return {
        message: {
          id: 'message-ticket',
          thread_id: USER_THREAD_ID,
          ticket_id: TICKET_ID,
          ticket,
          created_at: NOW,
          order_id: null,
        },
        emailDelivery: { ok: true },
      };
    },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(publishedInput, {
    companyId: COMPANY_ID,
    userId: USER_ID,
    threadUserId: USER_ID,
    senderRole: 'buyer',
    body: 'Pump pressure changed',
    orderId: null,
    source: 'dashboard',
    ticketId: null,
    threadId: null,
    subject: 'Pump-room scaling',
    category: 'technical',
    startTicket: true,
  });
  assert.equal(payload.ticket_id, TICKET_ID);
  assert.deepEqual(payload.ticket, {
    id: TICKET_ID,
    ticket_number: 123,
    display_number: 'MAS-000123',
    thread_id: USER_THREAD_ID,
    subject: 'Pump-room scaling',
    status: 'open',
    priority: 'normal',
    category: 'technical',
    primary_order_id: null,
    first_response_at: null,
    resolved_at: null,
    last_message_at: NOW,
    last_message_body: 'Need help',
    last_sender_role: 'buyer',
    needs_staff_reply: true,
    created_at: '2026-09-06T14:00:00.000Z',
    updated_at: NOW,
  });
  assert.equal(Object.hasOwn(payload.ticket, 'assigned_to'), false);
  assert.equal(Object.hasOwn(payload.ticket, 'version'), false);
});

test('explicit buyer ticket creation reports the pre-activation gate without masking it', async () => {
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => buyerContext({}),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({
      action: 'start_ticket',
      body: 'A distinct issue',
    }),
    publishSupportMessage: async () => {
      throw new Error('support_ticket_routing_not_enabled');
    },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 409,
    body: { error: 'support_ticket_routing_not_enabled' },
  });
});

test('buyer explicit ticket ownership fails closed before publication', async () => {
  let published = false;
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => buyerContext({}),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({ body: 'Wrong ticket', ticket_id: TICKET_ID }),
    supportTicketById: async () => supportTicket({ thread_id: COMPANY_THREAD_ID }),
    visibleSupportThreadIds: async () => [USER_THREAD_ID],
    publishSupportMessage: async () => { published = true; },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'ticket_not_found' } });
  assert.equal(published, false);
});

test('buyer can reply to an exact visible company-wide ticket through its canonical thread', async () => {
  let publishedInput;
  const handler = createAccountMessagesHandler({
    requireCommerceUser: async () => buyerContext({}),
    rateLimit: async () => ({ ok: true }),
    readBody: async () => ({ body: 'Company-wide reply', ticket_id: TICKET_ID, action: 'start_ticket' }),
    supportTicketById: async () => supportTicket({ thread_id: COMPANY_THREAD_ID }),
    visibleSupportThreadIds: async () => [USER_THREAD_ID, COMPANY_THREAD_ID],
    publishSupportMessage: async (_env, _sb, input) => {
      publishedInput = input;
      return {
        message: {
          id: 'message-company-ticket', thread_id: COMPANY_THREAD_ID, ticket_id: TICKET_ID,
          ticket: supportTicket({ thread_id: COMPANY_THREAD_ID }), created_at: NOW, order_id: null,
        },
        emailDelivery: { ok: true },
      };
    },
  });

  const response = await handler({ request: routeRequest('account/messages', 'POST'), env: {} });

  assert.equal(response.status, 201);
  assert.equal(publishedInput.ticketId, TICKET_ID);
  assert.equal(publishedInput.threadId, COMPANY_THREAD_ID);
  assert.equal(publishedInput.startTicket, true);
  assert.equal(publishedInput.userId, USER_ID);
  assert.equal((await response.json()).ticket.thread_id, COMPANY_THREAD_ID);
});

test('staff explicit ticket reply keeps exact ticket and ignores spoofed thread identity', async () => {
  let publishedInput;
  const thread = {
    ...participantThread({ company_id: null }),
    company_name: null,
    company_status: null,
    participant: { id: USER_ID, full_name: 'Ada Buyer', email: 'buyer@example.test' },
    scope: 'user',
  };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({
      from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    }),
    readBody: async () => ({
      ticket_id: TICKET_ID,
      start_ticket: true,
      thread_id: COMPANY_THREAD_ID,
      recipient_user_id: OTHER_USER_ID,
      body: ' Exact reply ',
    }),
    supportTicketById: async () => supportTicket(),
    loadThread: async (_sb, { threadId }) => {
      assert.equal(threadId, USER_THREAD_ID);
      return thread;
    },
    resolveSupportRecipient: async (_sb, input) => {
      assert.deepEqual(input, { companyId: null, userId: USER_ID });
      return { id: USER_ID, company_id: null, email: 'buyer@example.test' };
    },
    publishSupportMessage: async (_env, _sb, input) => {
      publishedInput = input;
      return {
        message: {
          id: 'message-ticket', thread_id: USER_THREAD_ID, ticket_id: TICKET_ID,
          ticket: supportTicket({ last_sender_role: 'staff' }), created_at: NOW,
          order_id: null, recipient_user_id: USER_ID,
        },
        emailDelivery: { ok: true },
      };
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(publishedInput.ticketId, TICKET_ID);
  assert.equal(publishedInput.threadId, USER_THREAD_ID);
  assert.equal(publishedInput.recipientUserId, USER_ID);
  assert.equal(payload.ticket_id, TICKET_ID);
  assert.equal(payload.ticket.version, 7);
});

test('staff exact company-wide ticket reply ignores forged routing hints and guesses no email identity', async () => {
  let rpcCall;
  let recipientLookups = 0;
  let deliveredMessage;
  const companyTicket = supportTicket({ thread_id: COMPANY_THREAD_ID });
  const companyWide = {
    ...companyThread(),
    company_name: 'Acme HVAC', company_status: 'approved', scope: 'company', participant: null,
  };
  const sb = {
    async rpc(name, args) {
      rpcCall = { name, args };
      return {
        data: {
          id: 'company-wide-staff-message', thread_id: COMPANY_THREAD_ID,
          ticket_id: TICKET_ID, company_id: COMPANY_ID, recipient_user_id: null,
          created_at: NOW, order_id: null, ticket: companyTicket,
        },
        error: null,
      };
    },
  };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => sb,
    readBody: async () => ({
      ticket_id: TICKET_ID,
      company_id: OTHER_COMPANY_ID,
      recipient_user_id: OTHER_USER_ID,
      body: 'Company-wide follow-up',
    }),
    supportTicketById: async () => companyTicket,
    loadThread: async () => companyWide,
    resolveSupportRecipient: async () => {
      recipientLookups += 1;
      throw new Error('must not guess a company recipient');
    },
    publishSupportMessage: (env, client, input) => publishSupportMessage(env, client, input, {
      append: appendSupportMessage,
      deliver: async (_env, _client, message) => {
        deliveredMessage = message;
        return { ok: false, skipped: 'recipient_not_found', retryable: false };
      },
    }),
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(recipientLookups, 0);
  assert.equal(rpcCall.name, 'append_support_message');
  assert.equal(rpcCall.args.p_thread_id, COMPANY_THREAD_ID);
  assert.equal(rpcCall.args.p_ticket_id, TICKET_ID);
  assert.equal(rpcCall.args.p_company_id, COMPANY_ID);
  assert.equal(rpcCall.args.p_recipient_user_id, null);
  assert.equal(rpcCall.args.p_thread_user_id, null);
  assert.equal(deliveredMessage.recipient_user_id, null);
  assert.deepEqual(payload.email_delivery, {
    ok: false, skipped: 'recipient_not_found', retryable: false,
  });
});

test('staff start_ticket on an existing thread delegates fresh episode selection to SQL', async () => {
  let publishedInput;
  let ticketLookups = 0;
  const thread = {
    ...participantThread(),
    company_name: 'Acme HVAC',
    company_status: 'approved',
    participant: { id: USER_ID, full_name: 'Ada Buyer', email: 'buyer@example.test' },
    scope: 'user',
  };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({
      from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    }),
    readBody: async () => ({
      thread_id: USER_THREAD_ID,
      start_ticket: true,
      subject: 'A separate issue',
      body: 'Start a distinct support episode.',
    }),
    supportTicketForThread: async () => { ticketLookups += 1; return supportTicket(); },
    loadThread: async () => thread,
    resolveSupportRecipient: async () => ({ id: USER_ID, company_id: COMPANY_ID }),
    publishSupportMessage: async (_env, _sb, input) => {
      publishedInput = input;
      return {
        message: {
          id: 'new-ticket-message', thread_id: USER_THREAD_ID, ticket_id: TICKET_ID,
          ticket: supportTicket({ subject: 'A separate issue' }), created_at: NOW,
          order_id: null, recipient_user_id: USER_ID,
        },
        emailDelivery: { ok: true },
      };
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'POST'), env: {} });

  assert.equal(response.status, 201);
  assert.equal(ticketLookups, 0);
  assert.equal(publishedInput.threadId, USER_THREAD_ID);
  assert.equal(publishedInput.ticketId, null);
  assert.equal(publishedInput.startTicket, true);
});

test('legacy staff thread detail keeps thread-wide history until the ticket UI cutover', async () => {
  const ticketFilters = [];
  let selected = false;
  const rows = [
    { id: 'message-one', thread_id: USER_THREAD_ID, ticket_id: TICKET_ID, sender_role: 'buyer', body: 'First ticket', order_id: null, created_at: NOW },
    { id: 'message-two', thread_id: USER_THREAD_ID, ticket_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sender_role: 'staff', body: 'Second ticket', order_id: null, created_at: NOW },
  ];
  const makeBuilder = () => ({
    select() { selected = true; return this; },
    update() { selected = false; return this; },
    eq(column, value) { if (column === 'ticket_id') ticketFilters.push(value); return this; },
    order() { return this; },
    limit() { return this; },
    lt() { return this; },
    then(resolve, reject) {
      return Promise.resolve(selected ? { data: rows, error: null } : { data: [], error: null }).then(resolve, reject);
    },
  });
  const thread = {
    ...participantThread(),
    company_name: 'Acme HVAC', company_status: 'approved', scope: 'user', participant: null,
  };
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({ from: () => makeBuilder() }),
    loadThread: async () => thread,
    supportTicketForThread: async () => supportTicket(),
  });

  const response = await handler({
    request: new Request(`https://masest.test/api/admin/messages?thread_id=${USER_THREAD_ID}`),
    env: {},
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.messages.map((message) => message.ticket_id).sort(), [
    TICKET_ID,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ].sort());
  assert.deepEqual(ticketFilters, []);
});

test('explicit ticket status update requires a version and reports stale compare-and-swap', async () => {
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({}),
    readBody: async () => ({ ticket_id: TICKET_ID, status: 'resolved', version: 6 }),
    supportTicketById: async () => supportTicket(),
    updateSupportTicket: async () => {
      throw Object.assign(new Error('ticket_version_conflict'), { code: 'P0001' });
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 409,
    body: { error: 'ticket_version_conflict' },
  });
});

test('explicit ticket status update rejects a missing version before mutation', async () => {
  let mutations = 0;
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({}),
    readBody: async () => ({ ticket_id: TICKET_ID, status: 'resolved' }),
    supportTicketById: async () => supportTicket(),
    updateSupportTicket: async () => { mutations += 1; },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 400,
    body: { error: 'ticket_version_required' },
  });
  assert.equal(mutations, 0);
});

test('explicit ticket PATCH accepts canonical waiting status and priority without legacy remapping', async () => {
  let updateInput;
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({}),
    readBody: async () => ({
      ticket_id: TICKET_ID,
      status: 'waiting_on_customer',
      priority: 'urgent',
      version: 7,
    }),
    supportTicketById: async () => supportTicket(),
    updateSupportTicket: async (_sb, input) => {
      updateInput = input;
      return supportTicket({ status: 'waiting_on_customer', priority: 'urgent', version: 8 });
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });

  assert.equal(response.status, 200);
  assert.deepEqual(updateInput, {
    ticketId: TICKET_ID,
    expectedVersion: 7,
    actorId: STAFF_ID,
    status: 'waiting_on_customer',
    priority: 'urgent',
  });
});

test('legacy thread status control selects one ticket server-side and still uses CAS', async () => {
  let updateInput;
  const thread = participantThread();
  const handler = createAdminMessagesHandler({
    requireStaff: async () => staffContext(),
    adminClient: () => ({}),
    readBody: async () => ({ thread_id: USER_THREAD_ID, status: 'escalated' }),
    loadThread: async (_sb, { threadId }) => {
      assert.equal(threadId, USER_THREAD_ID);
      return thread;
    },
    supportTicketForThread: async (_sb, threadId) => {
      assert.equal(threadId, USER_THREAD_ID);
      return supportTicket();
    },
    updateSupportTicket: async (_sb, input) => {
      updateInput = input;
      return supportTicket({ priority: 'high', version: 8 });
    },
  });

  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(updateInput, {
    ticketId: TICKET_ID,
    expectedVersion: 7,
    actorId: STAFF_ID,
    status: 'open',
    priority: 'high',
  });
  assert.equal(payload.thread_id, USER_THREAD_ID);
  assert.equal(payload.ticket_id, TICKET_ID);
  assert.equal(payload.status, 'escalated');
  assert.equal(payload.ticket.version, 8);
});
