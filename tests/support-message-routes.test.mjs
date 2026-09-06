import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { createAccountMessagesHandler } from '../functions/api/account/messages.js';
import { createAdminMessagesHandler } from '../functions/api/admin/messages.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_COMPANY_ID = '55555555-5555-4555-8555-555555555555';
const USER_THREAD_ID = '66666666-6666-4666-8666-666666666666';
const COMPANY_THREAD_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '88888888-8888-4888-8888-888888888888';
const NOW = '2026-09-06T14:15:16.000Z';

const THREAD_SELECT = 'id,participant_user_id,company_id,status,completed_at,completed_by,last_message_at,last_message_body,last_sender_role,last_order_id';
const BUYER_MESSAGE_SELECT = 'id,thread_id,sender_role,body,order_id,source,created_at';
const STAFF_MESSAGE_SELECT = 'id,thread_id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references';
const ORDER_SELECT = 'id,order_number,status,company_id,user_id,customer_email';
const ORDER_CONTEXT_SELECT = 'id,order_number,status,company_id';
const PROFILE_SELECT = 'id,full_name,company_id';
const RECIPIENT_SELECT = 'id,company_id,full_name,notify_messages,support_chat_open,support_chat_seen_at';
const COMPANY_SELECT = 'id,name,status';

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

function adminHandler(sb, { context = staffContext(), body = {}, publisher, now } = {}) {
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
    body: { messages: [], has_more: false, next_before: null, order_scope: null },
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
    body: { messages: [{ ...row, order: null }], has_more: false, next_before: null, order_scope: null },
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
      order_scope: orderContext,
    },
  });
  assertBoundaries();
  sb.assertClean();
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
    op('neq', 'status', 'complete'),
  ];
  const sb = strictSupabase([
    query('support_threads', summarySelect, { data: null, count: 7, error: null }),
    query('support_threads', [...summarySelect, op('eq', 'last_sender_role', 'buyer')], {
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
  const orderContext = {
    id: ORDER_ID,
    reference: 'MST-1042',
    status: 'paid',
    buyer_url: `/dashboard.html?order=${ORDER_ID}#orders`,
    admin_url: `/admin.html?order=${ORDER_ID}#orders`,
  };
  const sb = strictSupabase([
    query('support_threads', [
      op('select', THREAD_SELECT), op('not', 'last_message_at', 'is', null),
      op('neq', 'status', 'complete'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
    ], { data: rows, error: null }),
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

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      threads: [
        {
          thread_id: USER_THREAD_ID,
          company_id: COMPANY_ID,
          company_name: 'Acme HVAC',
          participant_user_id: USER_ID,
          participant: { id: USER_ID, full_name: 'Ada Buyer', email: null },
          scope: 'user',
          last_body: 'Need help',
          last_at: '2026-09-06T14:00:00.000Z',
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
          last_at: '2026-09-06T14:00:00.000Z',
          status: 'open',
          completed_at: null,
          unanswered: false,
          order: null,
        },
      ],
      summary: { open: 2, unanswered: 1 },
    },
  });
  assert.deepEqual(sb.authCalls, []);
  assertBoundaries();
  sb.assertClean();
});

test('read-only staff can list completed threads with the resolved summary contract', async () => {
  const completedAt = '2026-09-06T13:30:00.000Z';
  const row = participantThread({
    status: 'complete', completed_at: completedAt, completed_by: STAFF_ID, last_sender_role: 'staff',
  });
  const sb = strictSupabase([
    query('support_threads', [
      op('select', THREAD_SELECT), op('not', 'last_message_at', 'is', null),
      op('eq', 'status', 'complete'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
    ], { data: [row], error: null }),
    query('profiles', [op('select', PROFILE_SELECT), op('in', 'id', [USER_ID])], {
      data: [{ id: USER_ID, full_name: 'Ada Buyer', company_id: COMPANY_ID }], error: null,
    }),
    query('companies', [op('select', COMPANY_SELECT), op('in', 'id', [COMPANY_ID])], {
      data: [{ id: COMPANY_ID, name: 'Acme HVAC', status: 'approved' }], error: null,
    }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, { context: staffContext('read_only') });

  const response = await handler({ request: routeRequest('admin/messages?status=complete'), env: {} });

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      threads: [{
        thread_id: USER_THREAD_ID,
        company_id: COMPANY_ID,
        company_name: 'Acme HVAC',
        participant_user_id: USER_ID,
        participant: { id: USER_ID, full_name: 'Ada Buyer', email: null },
        scope: 'user',
        last_body: 'Need help',
        last_at: '2026-09-06T14:00:00.000Z',
        status: 'complete',
        completed_at: completedAt,
        unanswered: false,
        order: null,
      }],
      summary: { resolved: 1 },
    },
  });
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

  assert.deepEqual(await responseShape(response), {
    status: 200,
    body: {
      messages: [
        { ...older, order: null, participant },
        { ...newer, order: null, participant },
      ],
      has_more: false,
      next_before: null,
      thread: {
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
      },
    },
  });
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
    ['open', { status: 'open', completed_at: null, completed_by: null }],
    ['escalated', { status: 'escalated', completed_at: null, completed_by: null }],
    ['complete', { status: 'complete', completed_at: NOW, completed_by: STAFF_ID }],
  ];
  for (const [status, patch] of cases) {
    await t.test(status, async () => {
      const sb = strictSupabase([
        single('support_threads', [
          op('update', patch), op('eq', 'id', USER_THREAD_ID), op('select', 'id,status'),
        ], { data: { id: USER_THREAD_ID, status }, error: null }),
      ]);
      const { handler, assertBoundaries } = adminHandler(sb, {
        body: { thread_id: USER_THREAD_ID, status },
      });
      const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });
      assert.deepEqual(await responseShape(response), {
        status: 200,
        body: { thread_id: USER_THREAD_ID, status },
      });
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
  const patch = { status: 'open', completed_at: null, completed_by: null };
  const sb = strictSupabase([
    single('support_threads', [
      op('update', patch), op('eq', 'id', USER_THREAD_ID), op('select', 'id,status'),
    ], { data: null, error: null }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { thread_id: USER_THREAD_ID, status: 'open' },
  });
  const response = await handler({ request: routeRequest('admin/messages', 'PATCH'), env: {} });

  assert.deepEqual(await responseShape(response), { status: 404, body: { error: 'thread_not_found' } });
  assertBoundaries({ parsedBody: 1 });
  sb.assertClean();
});

test('staff PATCH masks database update errors', async () => {
  const patch = { status: 'open', completed_at: null, completed_by: null };
  const sb = strictSupabase([
    single('support_threads', [
      op('update', patch), op('eq', 'id', USER_THREAD_ID), op('select', 'id,status'),
    ], { data: null, error: new Error('database secret detail') }),
  ]);
  const { handler, assertBoundaries } = adminHandler(sb, {
    body: { thread_id: USER_THREAD_ID, status: 'open' },
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
    senderRole: 'staff',
    body: 'Order update is ready',
    orderId: ORDER_ID,
    source: 'admin',
    reopen: false,
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
    query('support_threads', [
      op('select', THREAD_SELECT), op('not', 'last_message_at', 'is', null),
      op('neq', 'status', 'complete'), op('order', 'last_message_at', { ascending: false }), op('limit', 500),
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
