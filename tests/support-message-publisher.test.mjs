import assert from 'node:assert/strict';
import test from 'node:test';

import { publishSupportMessage } from '../functions/_lib/support-message-publisher.js';
import { onRequest as accountMessagesRoute } from '../functions/api/account/messages.js';
import { onRequest as adminMessagesRoute } from '../functions/api/admin/messages.js';

const originalFetch = globalThis.fetch;
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

test('support publisher persists once and reports durable queued delivery', async () => {
  const env = { APP_URL: 'https://masest.co' };
  const sb = { name: 'database' };
  const message = { id: 'message-1', company_id: 'company-1', sender_role: 'staff' };
  const calls = [];

  const result = await publishSupportMessage(env, sb, input, {
    append: async (receivedSb, receivedInput) => {
      calls.push(['append', receivedSb, receivedInput]);
      return message;
    },
  });

  assert.deepEqual(calls, [
    ['append', sb, input],
  ]);
  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, { ok: true, queued: true });
});

test('support publisher preserves durable queue when delivery is unavailable', async () => {
  const message = { id: 'message-2', company_id: 'company-1', sender_role: 'staff' };

  const result = await publishSupportMessage({}, {}, input, {
    append: async () => message,
  });

  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, { ok: true, queued: true });
});

function readinessFailureFetch({ staff = false } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ path: url.pathname, method, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json(staff
        ? { id: 'staff-1', email: 'staff@example.test' }
        : { id: 'buyer-1', email: 'buyer@example.test' });
    }
    if (url.pathname.endsWith('/rest/v1/profiles')) {
      if (url.search.includes('notify_messages')) {
        return Response.json([{ id: 'buyer-1', company_id: 'company-1', full_name: 'Buyer', notify_messages: true, support_chat_open: false, support_chat_seen_at: null }]);
      }
      return Response.json([{ id: 'buyer-1', company_id: null, role: 'buyer', full_name: 'Buyer', phone: null }]);
    }
    if (url.pathname.endsWith('/auth/v1/admin/users/buyer-1')) {
      return Response.json({ user: { id: 'buyer-1', email: 'buyer@example.test' } });
    }
    if (url.pathname.endsWith('/rest/v1/rpc/assert_email_effects_ready')) {
      return Response.json({ code: 'email_effects_not_ready' }, { status: 503 });
    }
    throw new Error(`Unexpected readiness test fetch: ${method} ${url}`);
  };
  return calls;
}

test('buyer POST fails closed at readiness boundary before support message write', async () => {
  const calls = readinessFailureFetch();
  const request = new Request('https://masest.test/api/account/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer buyer-token', 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Need help with this order.', source: 'customer_chat' }),
  });
  const response = await accountMessagesRoute({ request, env: ENV });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'durable_email_effects_not_ready', retryable: true });
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/messages')), false);
});

test('staff POST fails closed at readiness boundary before support message or notification writes', async () => {
  const calls = readinessFailureFetch({ staff: true });
  const request = new Request('https://masest.test/api/admin/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'We have an update.', recipient_user_id: 'buyer-1', company_id: 'company-1' }),
  });
  const response = await adminMessagesRoute({ request, env: ENV });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'durable_email_effects_not_ready', retryable: true });
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/messages')), false);
  assert.equal(calls.some(({ path }) => path.endsWith('/rest/v1/notifications')), false);
});
