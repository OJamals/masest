import assert from 'node:assert/strict';
import test from 'node:test';

import { attemptSupportMessageDelivery } from '../functions/_lib/support-delivery.js';

const MESSAGE_ID = '00000000-0000-4000-8000-000000000041';
const EFFECT_ID = '00000000-0000-4000-8000-000000000042';

const message = {
  id: MESSAGE_ID,
  ticket_id: '00000000-0000-4000-8000-000000000043',
  sender_role: 'staff',
};

test('immediate support delivery claims only the canonical message effect and uses the shared processor', async () => {
  const calls = [];
  const result = await attemptSupportMessageDelivery({
    env: {},
    sb: {},
    message,
    workerId: 'support-immediate/request-1',
  }, {
    claimEffect: async (_sb, input) => {
      calls.push(['claim', input]);
      return {
        state: 'claimed',
        effect: {
          id: EFFECT_ID,
          lease_owner: input.workerId,
          effect_type: 'support_message_email',
          payload: { message_id: MESSAGE_ID },
        },
      };
    },
    processEffect: async (input) => {
      calls.push(['process', input.effect.id, input.workerId]);
      return { state: 'delivered', effectId: EFFECT_ID };
    },
  });

  assert.deepEqual(calls, [
    ['claim', { messageId: MESSAGE_ID, workerId: 'support-immediate/request-1', leaseSeconds: 60 }],
    ['process', EFFECT_ID, 'support-immediate/request-1'],
  ]);
  assert.deepEqual(result, { state: 'delivered', effect_id: EFFECT_ID });
});

test('a live lease or retry backoff stays queued without another provider call', async (t) => {
  for (const state of ['processing', 'pending', 'retry']) {
    await t.test(state, async () => {
      let processed = 0;
      const result = await attemptSupportMessageDelivery({
        env: {}, sb: {}, message, workerId: 'support-immediate/request-2',
      }, {
        claimEffect: async () => ({ state, effect: { id: EFFECT_ID } }),
        processEffect: async () => { processed += 1; },
      });
      assert.equal(processed, 0);
      assert.deepEqual(result, { state: 'queued', effect_id: EFFECT_ID });
    });
  }
});

test('completed policy skips and terminal effects remain distinguishable', async (t) => {
  const cases = [
    [{ state: 'completed', effect: { id: EFFECT_ID, provider_result: { skipped: 'recipient_opted_out' } } },
      { state: 'skipped', effect_id: EFFECT_ID, reason: 'recipient_opted_out' }],
    [{ state: 'completed', effect: { id: EFFECT_ID, provider_result: { provider_message_id: 'provider-1' } } },
      { state: 'delivered', effect_id: EFFECT_ID }],
    [{ state: 'dead', effect: { id: EFFECT_ID, last_error_code: 'email_delivery_state_unknown' } },
      { state: 'dead', effect_id: EFFECT_ID, reason: 'email_delivery_state_unknown' }],
  ];
  for (const [claim, expected] of cases) {
    await t.test(claim.state + JSON.stringify(claim.effect.provider_result || {}), async () => {
      const result = await attemptSupportMessageDelivery({
        env: {}, sb: {}, message, workerId: 'support-immediate/request-3',
      }, { claimEffect: async () => claim });
      assert.deepEqual(result, expected);
    });
  }
});

test('a legacy duplicate without a cutover effect reports operator attention and never sends', async () => {
  let processed = 0;
  const result = await attemptSupportMessageDelivery({
    env: {}, sb: {}, message, workerId: 'support-immediate/request-4',
  }, {
    claimEffect: async () => ({ state: 'legacy', effect: null }),
    processEffect: async () => { processed += 1; },
  });

  assert.equal(processed, 0);
  assert.deepEqual(result, {
    state: 'dead',
    effect_id: null,
    reason: 'legacy_delivery_effect_missing',
  });
});
