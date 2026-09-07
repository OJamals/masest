import assert from 'node:assert/strict';
import test from 'node:test';

import { publishSupportMessage } from '../functions/_lib/support-message-publisher.js';
import { onRequest as accountMessagesRoute } from '../functions/api/account/messages.js';
import { onRequest as adminMessagesRoute } from '../functions/api/admin/messages.js';

const originalFetch = globalThis.fetch;
const BUYER_ID = '00000000-0000-4000-8000-000000000101';
const STAFF_ID = '00000000-0000-4000-8000-000000000102';
const ENV = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ADMIN_EMAILS: 'staff@example.test',
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const input = {
  companyId: 'company-1',
  recipientUserId: 'user-1',
  senderRole: 'staff',
  body: 'Order update',
  source: 'admin',
};

test('support publisher persists once, then claims the canonical message effect', async () => {
  const env = { APP_URL: 'https://masest.co' };
  const sb = { name: 'database' };
  const message = { id: 'message-1', company_id: 'company-1', sender_role: 'staff' };
  const calls = [];

  const result = await publishSupportMessage(env, sb, input, {
    append: async (receivedSb, receivedInput) => {
      calls.push(['append', receivedSb, receivedInput]);
      return message;
    },
    createWorkerId: () => 'support-immediate/test-1',
    attemptDelivery: async (options) => {
      calls.push(['attempt', options]);
      return { state: 'delivered', effect_id: 'effect-1' };
    },
  });

  assert.deepEqual(calls, [
    ['append', sb, input],
    ['attempt', {
      env,
      sb,
      message,
      workerId: 'support-immediate/test-1',
    }],
  ]);
  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, { state: 'delivered', effect_id: 'effect-1' });
});

test('support publisher keeps the canonical message when counterpart email delivery throws', async () => {
  const message = { id: 'message-2', company_id: 'company-1', sender_role: 'staff' };

  const result = await publishSupportMessage({}, {}, input, {
    append: async () => message,
    createWorkerId: () => 'support-immediate/test-2',
    attemptDelivery: async () => { throw new Error('provider unavailable'); },
  });

  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, {
    state: 'dead',
    effect_id: null,
    reason: 'support_delivery_status_unavailable',
  });
});

function readinessFailureFetch({ staff = false } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ path: url.pathname, method, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json(staff
        ? { id: STAFF_ID, email: 'staff@example.test' }
        : { id: BUYER_ID, email: 'buyer@example.test' });
    }
    if (url.pathname.endsWith('/rest/v1/profiles')) {
      return Response.json([{ id: BUYER_ID, company_id: null, role: 'buyer', full_name: 'Buyer', phone: null }]);
    }
    if (url.pathname.endsWith(`/auth/v1/admin/users/${BUYER_ID}`)) {
      return Response.json({ user: { id: BUYER_ID, email: 'buyer@example.test' } });
    }
    if (url.pathname.endsWith('/rest/v1/rpc/assert_email_effects_ready')) {
      return Response.json({ code: 'email_effects_not_ready' }, { status: 503 });
    }
    throw new Error(`Unexpected readiness test fetch: ${method} ${url}`);
  };
  return calls;
}

test('buyer v2 ticket POST fails closed at readiness before message persistence', async () => {
  const calls = readinessFailureFetch();
  const request = new Request('https://masest.test/api/account/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer buyer-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start_ticket', body: 'Need help with this order.', source: 'customer_chat' }),
  });
  const response = await accountMessagesRoute({ request, env: ENV });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'durable_email_effects_not_ready', retryable: true });
  assert.equal(calls.filter(({ path }) => path.endsWith('/rest/v1/rpc/assert_email_effects_ready')).length, 1);
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/rpc/append_support_message_v2')), false);
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/notifications')), false);
});

test('staff v2 ticket POST fails closed at readiness before message or notification persistence', async () => {
  const calls = readinessFailureFetch({ staff: true });
  const request = new Request('https://masest.test/api/admin/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start_ticket', body: 'We have an update.', recipient_user_id: BUYER_ID }),
  });
  const response = await adminMessagesRoute({ request, env: ENV });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'durable_email_effects_not_ready', retryable: true });
  assert.equal(calls.filter(({ path }) => path.endsWith('/rest/v1/rpc/assert_email_effects_ready')).length, 1);
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/rpc/append_support_message_v2')), false);
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/notifications')), false);
});
