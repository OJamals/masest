import assert from 'node:assert/strict';
import test from 'node:test';

import { attemptSupportMessageDelivery } from '../functions/_lib/support-delivery.js';
import {
  deliverIntegrationEffect,
  processClaimedIntegrationEffect,
} from '../functions/_lib/integration-effects.js';

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

test('an unverified claim response never fabricates durable queued work', async () => {
  const result = await attemptSupportMessageDelivery({
    env: {}, sb: {}, message, workerId: 'support-immediate/request-unverified',
  }, {
    claimEffect: async () => ({ state: 'pending', effect: null }),
  });

  assert.deepEqual(result, {
    state: 'dead', effect_id: null, reason: 'support_delivery_status_unavailable',
  });
});

test('a ledger transition outage retains the verified effect identity and reports operator attention', async () => {
  const result = await attemptSupportMessageDelivery({
    env: {}, sb: {}, message, workerId: 'support-immediate/request-ledger-outage',
  }, {
    claimEffect: async () => ({
      state: 'claimed',
      effect: { id: EFFECT_ID, lease_owner: 'support-immediate/request-ledger-outage' },
    }),
    processEffect: async () => { throw new Error('ledger unavailable'); },
  });

  assert.deepEqual(result, {
    state: 'dead', effect_id: EFFECT_ID, reason: 'support_delivery_status_unavailable',
  });
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

function claimedEffect(overrides = {}) {
  return {
    id: EFFECT_ID,
    event_id: '00000000-0000-4000-8000-000000000044',
    effect_key: 'email-counterpart',
    effect_type: 'support_message_email',
    aggregate_type: 'support_ticket',
    aggregate_id: message.ticket_id,
    payload: { message_id: MESSAGE_ID },
    lease_owner: 'worker-support',
    attempt_count: 1,
    provider_succeeded_at: null,
    provider: 'masest',
    environment_or_tenant: 'production',
    provider_event_id: `support-message/${MESSAGE_ID}`,
    provider_event_type: 'support.message.created',
    provider_object_id: MESSAGE_ID,
    ...overrides,
  };
}

const canonicalMessage = {
  ...message,
  thread_id: '00000000-0000-4000-8000-000000000045',
  company_id: '00000000-0000-4000-8000-000000000046',
  recipient_user_id: '00000000-0000-4000-8000-000000000047',
  body: 'Canonical support reply',
};

function deliveryDependencies(overrides = {}) {
  return {
    loadSupportMessage: async () => canonicalMessage,
    freezeEnvelope: async (_sb, input) => input.envelope,
    buyerRecipient: async () => ({
      email: 'buyer@example.test', notify_messages: true, support_chat_open: false,
    }),
    orderContext: async () => null,
    ticketContext: async () => ({ id: message.ticket_id, ticket_number: 41, subject: 'Proof' }),
    threadParent: async () => null,
    replyAddress: async () => 'reply+proof@reply.masest.co',
    saveDelivery: async () => {},
    ...overrides,
  };
}

test('support integration effect records only bounded provider identity after an exact frozen send', async () => {
  let calls = 0;
  const result = await deliverIntegrationEffect({
    env: {}, sb: {}, effect: claimedEffect(),
  }, deliveryDependencies({
    sendEmail: async () => {
      calls += 1;
      return { ok: true, providerMessageId: '<provider-41@example.test>', status: 202 };
    },
  }));

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    providerRecorded: false,
    providerResult: {
      provider_message_id: '<provider-41@example.test>',
      delivery_state: 'delivered',
    },
    skipped: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /buyer@example|Canonical support reply/);
});

test('support policy skip completes, retryable outage queues, and operational failure dies', async (t) => {
  const cases = [
    {
      name: 'policy skip',
      delivery: deliveryDependencies({ buyerRecipient: async () => null }),
      failStatus: null,
      expected: { state: 'skipped', reason: 'recipient_not_found', maxAttempts: null },
    },
    {
      name: 'retryable outage',
      delivery: deliveryDependencies({
        sendEmail: async () => ({ ok: false, retryable: true, error: 'email_gateway_unavailable' }),
      }),
      failStatus: 'pending',
      expected: { state: 'queued', reason: 'email_gateway_unavailable', maxAttempts: 8 },
    },
    {
      name: 'delivery state unknown',
      delivery: deliveryDependencies({
        sendEmail: async () => ({ ok: false, retryable: false, error: 'email_delivery_state_unknown' }),
      }),
      failStatus: 'dead',
      expected: { state: 'dead', reason: 'email_delivery_state_unknown', maxAttempts: 1 },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let failedWith = null;
      const sb = {
        async rpc(name, input) {
          if (name === 'record_integration_effect_success' || name === 'complete_integration_effect') {
            return { data: true, error: null };
          }
          if (name === 'fail_integration_effect') {
            failedWith = input;
            return { data: entry.failStatus, error: null };
          }
          throw new Error(`unexpected RPC ${name}`);
        },
      };
      const result = await processClaimedIntegrationEffect({
        env: {}, sb, effect: claimedEffect(), workerId: 'worker-support',
      }, {
        deliverEffect: (input) => deliverIntegrationEffect(input, entry.delivery),
      });
      assert.equal(result.state, entry.expected.state);
      assert.equal(result.reason, entry.expected.reason);
      assert.equal(failedWith?.p_max_attempts ?? null, entry.expected.maxAttempts);
    });
  }
});

test('message query outage retries while a successful missing-row lookup dead-letters', async (t) => {
  for (const [name, queryResult, failStatus, expectedState, expectedMax] of [
    ['query outage', { data: null, error: new Error('db unavailable') }, 'pending', 'queued', 8],
    ['missing row', { data: null, error: null }, 'dead', 'dead', 1],
  ]) {
    await t.test(name, async () => {
      let failedWith;
      const builder = {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return queryResult; },
      };
      const sb = {
        from(table) {
          assert.equal(table, 'messages');
          return builder;
        },
        async rpc(rpcName, input) {
          assert.equal(rpcName, 'fail_integration_effect');
          failedWith = input;
          return { data: failStatus, error: null };
        },
      };
      const result = await processClaimedIntegrationEffect({
        env: {}, sb, effect: claimedEffect(), workerId: 'worker-support',
      });
      assert.equal(result.state, expectedState);
      assert.equal(failedWith.p_max_attempts, expectedMax);
    });
  }
});
