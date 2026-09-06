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
    state: 'queued',
    effect_id: null,
    reason: 'support_delivery_status_unavailable',
  });
});
