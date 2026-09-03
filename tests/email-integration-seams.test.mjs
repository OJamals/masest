import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverIntegrationEffect } from '../functions/_lib/integration-effects.js';

const command = {
  id: 'command-1',
  order_id: 'order-1',
  type: 'refund',
  status: 'completed',
  amount_minor: 2500,
  currency: 'usd',
  reason: 'Customer requested cancellation',
  provider_idempotency_key: 'refund-1',
  provider_object_id: 're_1',
  provider_result: { fully_refunded: false },
  accounting_result: {},
  snapshot: {
    order_number: 'MST-00000126',
    notification: { recipients: ['buyer@example.com'] },
  },
};

function commandDb() {
  return {
    from(table) {
      assert.equal(table, 'order_reversal_commands');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: command, error: null }; },
      };
    },
  };
}

for (const [effectType, expected] of [
  ['order_refund_email', /USD 25\.00 refund issued/],
  ['order_cancellation_email', /Order MST-00000126 was canceled/],
]) {
  test(`${effectType} uses canonical commerce renderer`, async () => {
    let email;
    const outcome = await deliverIntegrationEffect({
      env: { APP_URL: 'https://masest.co' },
      sb: commandDb(),
      effect: {
        id: `${effectType}-1`, provider: 'masest', provider_event_id: 'event-1',
        effect_key: effectType, effect_type: effectType,
        payload: { order_id: 'order-1', command_id: 'command-1', reason: command.reason },
      },
    }, { sendEmail: async (_env, input) => { email = input; return true; } });

    assert.equal(outcome.skipped, false);
    assert.match(email.subject, expected);
    assert.match(email.html, /https:\/\/media\.masest\.co\/site\/img\/masest-logo\.png/);
    assert.match(email.html, /Required order notice/);
    assert.match(email.text, /MST-00000126/);
    assert.doesNotMatch(email.html, /Advertisement|Unsubscribe/i);
  });
}
