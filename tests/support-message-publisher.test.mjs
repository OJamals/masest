import assert from 'node:assert/strict';
import test from 'node:test';

import { publishSupportMessage } from '../functions/_lib/support-message-publisher.js';

const input = {
  companyId: 'company-1',
  recipientUserId: 'user-1',
  senderRole: 'staff',
  body: 'Order update',
  source: 'admin',
};

test('support publisher persists once, then emails the canonical message row', async () => {
  const env = { APP_URL: 'https://masest.co' };
  const sb = { name: 'database' };
  const message = { id: 'message-1', company_id: 'company-1', sender_role: 'staff' };
  const calls = [];

  const result = await publishSupportMessage(env, sb, input, {
    append: async (receivedSb, receivedInput) => {
      calls.push(['append', receivedSb, receivedInput]);
      return message;
    },
    deliver: async (receivedEnv, receivedSb, receivedMessage) => {
      calls.push(['deliver', receivedEnv, receivedSb, receivedMessage]);
      return { ok: true, providerMessageId: 'email-1' };
    },
  });

  assert.deepEqual(calls, [
    ['append', sb, input],
    ['deliver', env, sb, message],
  ]);
  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, { ok: true, providerMessageId: 'email-1' });
});

test('support publisher keeps the canonical message when counterpart email delivery throws', async () => {
  const message = { id: 'message-2', company_id: 'company-1', sender_role: 'staff' };

  const result = await publishSupportMessage({}, {}, input, {
    append: async () => message,
    deliver: async () => { throw new Error('provider unavailable'); },
  });

  assert.equal(result.message, message);
  assert.deepEqual(result.emailDelivery, {
    ok: false,
    retryable: true,
    error: 'support_email_delivery_failed',
  });
});
